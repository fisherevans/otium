// Package handler implements otium's HTTP API. Handlers are thin: parse, call
// the store or the session builder, encode JSON. The interesting logic lives in
// internal/server/session (ranking) and internal/server/interests (ingest).
package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/fisherevans/otium/internal/server/feeds"
	"github.com/fisherevans/otium/internal/server/fulltext"
	"github.com/fisherevans/otium/internal/server/middleware"
	"github.com/fisherevans/otium/internal/server/session"
	"github.com/fisherevans/otium/internal/server/store"
	"github.com/fisherevans/otium/internal/server/youtube"
	"github.com/go-chi/chi/v5"
	"io"
	"log/slog"
	mrand "math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Handler struct {
	db       *store.DB
	ing      *feeds.Ingester
	ft       *fulltext.Fetcher
	log      *slog.Logger
	ytImport bool            // YouTube backlog import enabled (an API key is configured)
	yt       *youtube.Client // nil unless a Data API key is configured
}

func New(db *store.DB, ing *feeds.Ingester, log *slog.Logger) *Handler {
	return &Handler{db: db, ing: ing, ft: fulltext.New(), log: log}
}

// SetYouTubeImportEnabled toggles whether creating a YouTube source enqueues a
// backlog import and whether the re-sync endpoint accepts requests (#122).
func (h *Handler) SetYouTubeImportEnabled(v bool) { h.ytImport = v }

// SetYouTube supplies the Data API client used to resolve a channel identifier at
// create time and to answer the youtube-available capability flag (#126).
func (h *Handler) SetYouTube(c *youtube.Client) { h.yt = c }

// Config reports server capabilities the frontend needs to shape its UI - notably
// whether YouTube-native sources can be created (requires a Data API key).
func (h *Handler) Config(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"youtube_available": h.yt != nil,
	})
}

// ResolveYouTube resolves a channel URL / @handle / id / name to a canonical
// channel identity, so the add-source UI can confirm the right channel before
// creating the source (#126).
func (h *Handler) ResolveYouTube(w http.ResponseWriter, r *http.Request) {
	if h.yt == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "YouTube sources are not configured"})
		return
	}
	var body struct {
		Input string `json:"input"`
	}
	if !decode(w, r, &body) {
		return
	}
	rc, err := h.yt.ResolveChannel(r.Context(), body.Input)
	if err != nil {
		badRequest(w, "couldn't resolve YouTube channel: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"channel_id": rc.ChannelID,
		"title":      rc.Title,
		"thumbnail":  rc.ThumbnailURL,
		"feed_url":   youtube.CanonicalFeedURL(rc.ChannelID),
	})
}

// --- users ---

func (h *Handler) GetMe(w http.ResponseWriter, r *http.Request) {
	id := middleware.IdentityFrom(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"id":       id.UserID,
		"username": id.Username,
		"email":    id.Email,
		"name":     id.Name,
	})
}

// --- interests ---

func (h *Handler) ListInterests(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	interests, err := h.db.ListInterests(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "list interests", err)
		return
	}
	writeJSON(w, http.StatusOK, interests)
}

func (h *Handler) CreateInterest(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	var body struct {
		Name  string `json:"name"`
		Slug  string `json:"slug"`
		Color string `json:"color"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Slug == "" {
		body.Slug = slugify(body.Name)
	}
	f, err := h.db.CreateInterest(r.Context(), uid, body.Name, body.Slug, body.Color)
	if err != nil {
		serverError(w, h.log, "create interest", err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

// UpdateInterest patches an interest's presentation fields (name, color, icon), the
// per-interest freshness half-life override (#17), and the Archive-After default.
// No engagement signal - pure curation.
func (h *Handler) UpdateInterest(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad interest id")
		return
	}
	var body struct {
		Name             *string  `json:"name"`
		Color            *string  `json:"color"`
		Icon             *string  `json:"icon"`
		HalfLifeDays     *float64 `json:"half_life_days"`
		ArchiveAfterDays *int     `json:"archive_after_days"` // #115: 0 inherit-global, -1 evergreen, N days
	}
	if !decode(w, r, &body) {
		return
	}
	if body.ArchiveAfterDays != nil {
		v := *body.ArchiveAfterDays
		if v < -1 {
			v = -1
		} else if v > 3650 {
			v = 3650
		}
		body.ArchiveAfterDays = &v
	}
	// Clamp the ranker overrides to sane bounds; 0 stays "use the global default".
	if body.HalfLifeDays != nil {
		v := *body.HalfLifeDays
		if v < 0 {
			v = 0
		} else if v > 365 {
			v = 365
		}
		body.HalfLifeDays = &v
	}
	if err := h.db.UpdateInterest(r.Context(), uid, id, body.Name, body.Color, body.Icon, body.HalfLifeDays, body.ArchiveAfterDays); err != nil {
		serverError(w, h.log, "update interest", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) SetInterestSources(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	interestID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad interest id")
		return
	}
	var body struct {
		SourceIDs []int64 `json:"source_ids"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := h.db.SetInterestSources(r.Context(), uid, interestID, body.SourceIDs); err != nil {
		serverError(w, h.log, "set interest sources", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// InterestItems returns recent items across a interest's sources (by interest id), backing
// the interest page's posts section (#66).
func (h *Handler) InterestItems(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad interest id")
		return
	}
	limit := intParam(r, "limit", 50)
	items, err := h.db.ListRecentItemsByInterest(r.Context(), uid, id, limit)
	if err != nil {
		serverError(w, h.log, "interest items", err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// --- sources ---

func (h *Handler) ListSources(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	sources, err := h.db.ListSources(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "list sources", err)
		return
	}
	writeJSON(w, http.StatusOK, sources)
}

// SourceStats returns the per-source transparency bundle for every source (#116):
// supply, publishing rate, and the engagement lifecycle. Keyed by source id.
func (h *Handler) SourceStats(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	stats, err := h.db.SourceStatsAll(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "source stats", err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (h *Handler) CreateSource(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	var body struct {
		Kind    string  `json:"kind"`
		Title   string  `json:"title"`
		FeedURL string  `json:"feed_url"`
		Weight  float64 `json:"weight"`
		State   string  `json:"state"`
		// #122: import the channel's backlog from the Data API on add. Defaults ON
		// for YouTube (nil = yes); ignored when the importer is disabled or the
		// source isn't YouTube.
		ImportBacklog *bool `json:"import_backlog"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.FeedURL == "" {
		badRequest(w, "feed_url is required")
		return
	}
	s := &store.Source{
		UserID:  uid,
		Kind:    body.Kind,
		Title:   body.Title,
		FeedURL: body.FeedURL,
		Weight:  body.Weight,
		State:   body.State,
	}
	// A YouTube source supplies a channel identifier (URL / @handle / id / name),
	// not an RSS URL (#126). Resolve it to the canonical channel feed_url and adopt
	// the channel's title + avatar when the caller didn't set them.
	if body.Kind == "youtube" && h.yt != nil {
		rc, err := h.yt.ResolveChannel(r.Context(), body.FeedURL)
		if err != nil {
			badRequest(w, "couldn't resolve YouTube channel: "+err.Error())
			return
		}
		s.FeedURL = youtube.CanonicalFeedURL(rc.ChannelID)
		if s.Title == "" {
			s.Title = rc.Title
		}
		if rc.ThumbnailURL != "" {
			s.IconURL = rc.ThumbnailURL
		}
	}
	created, err := h.db.CreateSource(r.Context(), s)
	if err != nil {
		serverError(w, h.log, "create source", err)
		return
	}
	// Pull its items immediately so a new source shows up in a session right away.
	if n, err := h.ing.FetchSource(r.Context(), *created); err != nil {
		h.log.Warn("initial fetch failed", "source", created.Title, "err", err)
	} else {
		h.log.Info("initial fetch", "source", created.Title, "new_items", n)
	}
	// Queue a backlog import (#122): RSS only gave the ~15 newest; the Data API
	// worker fills the rest back to the source's archive window. Default ON.
	if h.ytImport && created.Kind == "youtube" && (body.ImportBacklog == nil || *body.ImportBacklog) {
		if err := h.db.EnqueueImport(r.Context(), created.ID); err != nil {
			h.log.Warn("enqueue backlog import", "source", created.ID, "err", err)
		}
	}
	writeJSON(w, http.StatusCreated, created)
}

// ImportBacklog force-queues (or re-queues) a source's Data API backlog import - the
// "re-sync" action (#122). Re-running after widening the archive window fetches the
// newly-in-range older videos.
func (h *Handler) ImportBacklog(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad source id")
		return
	}
	if !h.ytImport {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "backlog import is not configured"})
		return
	}
	src, ok, err := h.db.SourceByID(r.Context(), id)
	if err != nil {
		serverError(w, h.log, "load source", err)
		return
	}
	if !ok || src.UserID != uid {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "source not found"})
		return
	}
	if src.Kind != "youtube" {
		badRequest(w, "backlog import is only for YouTube sources")
		return
	}
	if err := h.db.EnqueueImport(r.Context(), id); err != nil {
		serverError(w, h.log, "enqueue import", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) UpdateSource(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad source id")
		return
	}
	var body struct {
		Weight           *float64 `json:"weight"`
		Bucket           *string  `json:"weight_bucket"`
		State            *string  `json:"state"`
		Cap              *int     `json:"per_session_cap"`
		HalfLifeDays     *float64 `json:"half_life_days"`
		Title            *string  `json:"title"`
		ArchiveAfterDays *int     `json:"archive_after_days"` // #115: 0 inherit, -1 evergreen, N days
		ArchiveKeywords  *string  `json:"archive_keywords"`   // #118: comma-separated
		ArchiveKeepCount *int     `json:"archive_keep_count"` // #124: keep-latest-N, 0 = off
		ArchiveCombine   *string  `json:"archive_combine"`    // #124: "and" | "or"
		// #124 scoring: a structured object, re-serialized to the stored JSON after
		// validation. Send null/omit to leave unchanged; send an empty object or
		// {"direction":"newest"} to reset to the default (stored as "").
		ScoringConfig *session.ScoringConfig `json:"scoring_config"`
	}
	if !decode(w, r, &body) {
		return
	}
	patch := store.SourcePatch{
		State:            body.State,
		Cap:              body.Cap,
		Title:            body.Title,
		ArchiveKeywords:  body.ArchiveKeywords,
		ArchiveAfterDays: body.ArchiveAfterDays,
	}
	patch.Weight = body.Weight
	if body.Bucket != nil {
		wf, err := session.WeightForBucket(*body.Bucket)
		if err != nil {
			badRequest(w, err.Error())
			return
		}
		patch.Weight = &wf
	}
	// Clamp the half-life override to sane bounds; 0 stays "inherit" (interest/global).
	if body.HalfLifeDays != nil {
		v := *body.HalfLifeDays
		if v < 0 {
			v = 0
		} else if v > 365 {
			v = 365
		}
		patch.HalfLifeDays = &v
	}
	// Archive After: -1 (evergreen) and 0 (inherit) pass through; clamp positives.
	if body.ArchiveAfterDays != nil {
		v := *body.ArchiveAfterDays
		if v < -1 {
			v = -1
		} else if v > 3650 {
			v = 3650
		}
		patch.ArchiveAfterDays = &v
	}
	// Keep-latest-N count (#124): clamp to >= 0 (0 = off), sane ceiling.
	if body.ArchiveKeepCount != nil {
		v := *body.ArchiveKeepCount
		if v < 0 {
			v = 0
		} else if v > 100000 {
			v = 100000
		}
		patch.ArchiveKeepCount = &v
	}
	// Combine mode (#124): only "and" | "or"; anything else rejected.
	if body.ArchiveCombine != nil {
		c := strings.ToLower(strings.TrimSpace(*body.ArchiveCombine))
		if c != "and" && c != "or" {
			badRequest(w, "archive_combine must be 'and' or 'or'")
			return
		}
		patch.ArchiveCombine = &c
	}
	// Scoring config (#124): validate + normalize, then store as JSON ("" for the
	// default so a reset is byte-identical to a never-configured source).
	if body.ScoringConfig != nil {
		s, err := normalizeScoringConfig(*body.ScoringConfig)
		if err != nil {
			badRequest(w, err.Error())
			return
		}
		patch.ScoringConfig = &s
	}
	if err := h.db.UpdateSource(r.Context(), uid, id, patch); err != nil {
		serverError(w, h.log, "update source", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// normalizeScoringConfig validates a #124 scoring config and serializes it to the
// stored JSON. A default config (newest direction, no facets) serializes to "" so a
// reset source is byte-identical to a never-configured one. Unknown direction or
// length preference is a 400.
func normalizeScoringConfig(c session.ScoringConfig) (string, error) {
	switch c.Direction {
	case "", "newest", "oldest", "random":
	default:
		return "", fmt.Errorf("scoring direction must be newest, oldest, or random")
	}
	if c.Length != nil {
		switch c.Length.Prefer {
		case "longer", "shorter":
		default:
			return "", fmt.Errorf("scoring length.prefer must be longer or shorter")
		}
	}
	// Normalize "" to "newest" for a clean isDefault check, then blank the default.
	norm := session.ScoringConfig{Direction: c.Direction, Length: c.Length}
	if norm.Direction == "" {
		norm.Direction = "newest"
	}
	if norm.Direction == "newest" && norm.Length == nil {
		return "", nil // default: store blank
	}
	b, err := json.Marshal(norm)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ResetSourceMetadata clears the user's engagement state for a source (#119) -
// every item unread again. Optional older_than (RFC3339) resets only items
// published before it. The default falls back to the source's Archive-After when
// the client sends nothing? No: an empty body resets everything.
func (h *Handler) ResetSourceMetadata(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad source id")
		return
	}
	var body struct {
		OlderThan *string `json:"older_than"` // RFC3339; nil = reset all
	}
	if !decode(w, r, &body) {
		return
	}
	var older *time.Time
	if body.OlderThan != nil && *body.OlderThan != "" {
		t, perr := time.Parse(time.RFC3339, *body.OlderThan)
		if perr != nil {
			badRequest(w, "older_than must be RFC3339")
			return
		}
		older = &t
	}
	if err := h.db.ResetSourceMetadata(r.Context(), uid, id, older); err != nil {
		serverError(w, h.log, "reset source metadata", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ReplaceSourceFeedURL swaps a source's RSS URL and pulls the new feed once (#119).
func (h *Handler) ReplaceSourceFeedURL(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad source id")
		return
	}
	var body struct {
		FeedURL string `json:"feed_url"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.FeedURL == "" {
		badRequest(w, "feed_url is required")
		return
	}
	if err := h.db.ReplaceSourceFeedURL(r.Context(), uid, id, body.FeedURL); err != nil {
		serverError(w, h.log, "replace feed url", err)
		return
	}
	// The background ingest loop picks up the new URL on its next pass.
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) DeleteSource(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad source id")
		return
	}
	if err := h.db.DeleteSource(r.Context(), uid, id); err != nil {
		serverError(w, h.log, "delete source", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// SetSourceInterest sets the one interest a source belongs to (#86). An empty interest_slug
// clears the interest (interestless). Replaces the old multi-interest membership.
func (h *Handler) SetSourceInterest(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad source id")
		return
	}
	var body struct {
		InterestSlug string `json:"interest_slug"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := h.db.SetSourceInterest(r.Context(), uid, id, body.InterestSlug); err != nil {
		serverError(w, h.log, "set source interest", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) SourceItems(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad source id")
		return
	}
	limit := intParam(r, "limit", 50)
	items, err := h.db.ListSourceItemsWithState(r.Context(), uid, id, limit)
	if err != nil {
		serverError(w, h.log, "source items", err)
		return
	}
	if items == nil {
		items = []store.ItemWithState{}
	}
	writeJSON(w, http.StatusOK, items)
}

// --- sessions ---
//
// Sessions are durable and stateful (#67). CreateSession builds a finite queue
// from a single duration + themes (#69), stores it, and returns it; the queue
// and the read cursor live in the backend so a refresh or a return resumes the
// same items at the same place (CurrentSession) rather than rebuilding a fresh
// interest. One session per user is active at a time - creating a new one ends the
// previous. When the client decides the session is over (time budget reached or
// the queue exhausted) it PATCHes status='ended' and returns home.

// CreateSession builds the ranked queue for {duration_min, themes}, ends any
// prior active session, persists the new one, and returns its id + items +
// cursor. An empty selection (no sources / nothing new) returns session_id="" and
// no session row, so the client stays home instead of holding an empty session.
func (h *Handler) CreateSession(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	var body struct {
		DurationMin int      `json:"duration_min"`
		Themes      []string `json:"themes"` // interest slugs; empty = all followed sources
		Mixes       []string `json:"mixes"`  // mix slugs; each expands to its member interests (#86)
	}
	if !decode(w, r, &body) {
		return
	}
	if body.DurationMin <= 0 {
		body.DurationMin = 15
	}

	items, err := h.buildSessionQueue(r.Context(), uid, body.DurationMin, body.Themes, body.Mixes)
	if err != nil {
		serverError(w, h.log, "build session", err)
		return
	}
	if len(items) == 0 {
		writeJSON(w, http.StatusOK, sessionPayload("", body.DurationMin, 0, body.Themes, items))
		return
	}

	sid := randID()
	ids := make([]int64, len(items))
	for i, it := range items {
		ids[i] = it.Item.ID
	}
	// Items are NOT marked surfaced here - the queue is paced client-side, so an
	// item is only "seen" once it actually reaches the user (a `seen` event).
	if err := h.db.CreateSession(r.Context(), sid, uid, body.DurationMin, body.Themes, ids); err != nil {
		serverError(w, h.log, "create session", err)
		return
	}
	_ = h.db.LogEvent(r.Context(), uid, "session_build", nil, nil, sid,
		`{"count":`+strconv.Itoa(len(ids))+`,"duration":`+strconv.Itoa(body.DurationMin)+`,"themes":"`+strings.Join(body.Themes, ",")+`"}`)

	writeJSON(w, http.StatusCreated, sessionPayload(sid, body.DurationMin, 0, body.Themes, items))
}

// CurrentSession returns the user's active session rehydrated to its stored
// queue + cursor, so the SessionPage can resume it. 204 when there is none.
func (h *Handler) CurrentSession(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	s, err := h.db.CurrentSession(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "current session", err)
		return
	}
	if s == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	items, err := h.rehydrateSession(r.Context(), uid, s.ItemIDs)
	if err != nil {
		serverError(w, h.log, "rehydrate session", err)
		return
	}
	writeJSON(w, http.StatusOK, sessionPayload(s.ID, s.DurationMin, s.Cursor, s.Themes, items))
}

// UpdateSession advances the cursor and/or ends the session (#67). Both fields
// are optional; a cursor write after the session ended is a harmless no-op.
func (h *Handler) UpdateSession(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id := chi.URLParam(r, "id")
	var body struct {
		Cursor *int    `json:"cursor"`
		Status *string `json:"status"` // "ended"
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Cursor != nil {
		if err := h.db.UpdateSessionCursor(r.Context(), uid, id, *body.Cursor); err != nil {
			serverError(w, h.log, "advance cursor", err)
			return
		}
	}
	if body.Status != nil && *body.Status == "ended" {
		if err := h.db.EndSession(r.Context(), uid, id); err != nil {
			serverError(w, h.log, "end session", err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// buildSessionQueue resolves themes (interest slugs) and mixes (mix slugs, each
// expanding to its member interests' sources, #86), pulls the candidate pool +
// behavioral stats, runs the ranker for the single duration (fed as both bounds
// so the existing predict/selectivity path is unchanged), and attaches each
// item's interest. Returns an empty slice when the selection resolves to no sources.
func (h *Handler) buildSessionQueue(ctx context.Context, uid int64, durationMin int, themes, mixes []string) ([]session.Selected, error) {
	var sourceIDs []int64
	if len(themes) > 0 || len(mixes) > 0 {
		set := map[int64]struct{}{}
		if len(themes) > 0 {
			ids, err := h.db.SourceIDsForInterests(ctx, uid, themes)
			if err != nil {
				return nil, err
			}
			for _, id := range ids {
				set[id] = struct{}{}
			}
		}
		if len(mixes) > 0 {
			ids, err := h.db.SourceIDsForMixes(ctx, uid, mixes)
			if err != nil {
				return nil, err
			}
			for _, id := range ids {
				set[id] = struct{}{}
			}
		}
		// A selection that resolves to no sources yields an empty session, not "all".
		if len(set) == 0 {
			return nil, nil
		}
		sourceIDs = make([]int64, 0, len(set))
		for id := range set {
			sourceIDs = append(sourceIDs, id)
		}
	}

	// Engine v2 (#115): pull a broad candidate window (the allocator does its own
	// Archive-After eligibility, so `sinceDays` is just the cadence-stat window). The
	// row cap is generous so non-newest scoring directions (#124: oldest/random) and
	// low-cadence sources aren't clipped to the newest slice - the allocator's target
	// caps the actual session, this only bounds the pool it samples from.
	pool, err := h.db.Candidates(ctx, uid, sourceIDs, 400, 20000)
	if err != nil {
		return nil, err
	}
	stats, err := h.sourceStats(ctx, uid)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	// Queue size = a modest buffer over the predicted item count for the budget.
	// The consumed head is a representative sample; a big tail would over-sample
	// high-volume sources as low-volume ones exhaust, so keep the buffer small.
	target := session.PredictItems(durationMin, pool, stats)*2 + 4
	if target < 15 {
		target = 15
	}
	if target > 45 {
		target = 45
	}
	// Weighted-random source allocation, seeded off the clock (a fresh session is
	// a new sample; the stored queue makes resume stable).
	rng := mrand.New(mrand.NewSource(time.Now().UnixNano()))
	items := session.Allocate(pool, now, target, rng)
	h.attachInterests(ctx, uid, items)
	return items, nil
}

// rehydrateSession rebuilds the Selected view for a stored queue, preserving the
// queue's fixed order (no re-rank) and recomputing each item's current
// score/reason/breakdown. Items deleted since the build are dropped.
func (h *Handler) rehydrateSession(ctx context.Context, uid int64, itemIDs []int64) ([]session.Selected, error) {
	out := make([]session.Selected, 0, len(itemIDs)) // never nil: serialize as [] not null
	if len(itemIDs) == 0 {
		return out, nil
	}
	cands, err := h.db.CandidatesByIDs(ctx, uid, itemIDs)
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]store.Candidate, len(cands))
	for _, c := range cands {
		byID[c.ID] = c
	}
	now := time.Now().UTC()
	for _, id := range itemIDs {
		c, ok := byID[id]
		if !ok {
			continue
		}
		out = append(out, session.SelectFor(c, now))
	}
	h.attachInterests(ctx, uid, out)
	return out, nil
}

// sourceStats assembles the per-source behavioral + content signals the ranker
// folds in: empirical time-per-item (predicts how many items fit the budget) and
// skip history (downweights sources the user keeps passing on).
func (h *Handler) sourceStats(ctx context.Context, uid int64) (map[int64]session.SourceStat, error) {
	avgDur, err := h.db.SourceAvgDuration(ctx, uid, 100)
	if err != nil {
		return nil, err
	}
	skips, err := h.db.SourceSkipStats(ctx, uid)
	if err != nil {
		return nil, err
	}
	stats := map[int64]session.SourceStat{}
	for sid, avg := range avgDur {
		s := stats[sid]
		s.AvgContentSec = avg
		stats[sid] = s
	}
	for sid, sk := range skips {
		s := stats[sid]
		s.Shown, s.Skipped = sk.Shown, sk.Skipped
		stats[sid] = s
	}
	return stats, nil
}

// attachInterests fills each item's interest identity for the card's identity line (#86:
// a source's one interest). Interestless sources (interest_id NULL) stay nil and render
// source-only.
func (h *Handler) attachInterests(ctx context.Context, uid int64, items []session.Selected) {
	if len(items) == 0 {
		return
	}
	ids := make([]int64, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.Item.SourceID)
	}
	interestOf, err := h.db.InterestsForSources(ctx, uid, ids)
	if err != nil {
		h.log.Warn("resolve interests", "err", err)
		return
	}
	for i := range items {
		if f, ok := interestOf[items[i].Item.SourceID]; ok {
			fc := f
			items[i].Interest = &fc
		}
	}
}

// sessionPayload is the shared shape for POST /sessions and GET
// /sessions/current: the session identity + its queue + the read cursor.
func sessionPayload(id string, durationMin, cursor int, themes []string, items []session.Selected) map[string]any {
	if themes == nil {
		themes = []string{}
	}
	if items == nil {
		items = []session.Selected{}
	}
	return map[string]any{
		"session_id":   id,
		"duration_min": durationMin,
		"cursor":       cursor,
		"themes":       themes,
		"items":        items,
	}
}

// ItemEvent records an *explicit* interaction (open/like/skip/save/dismiss) and
// updates the item's state. These are the deliberate signals the ranker reads.
// Dwell is deliberately NOT handled here - it never touches item_state - it goes
// through ItemDwell into the append-only events log only (see the #68 policy on
// ItemDwell).
func (h *Handler) ItemEvent(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	itemID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad item id")
		return
	}
	var body struct {
		Type      string `json:"type"` // seen | open | like | skip | save | dismiss
		SessionID string `json:"session_id"`
	}
	if !decode(w, r, &body) {
		return
	}
	// `seen` = the item actually reached the user in the paced queue. Mark it
	// surfaced without downgrading a stronger state (a liked item stays liked).
	if body.Type == "seen" {
		if err := h.db.MarkSurfaced(r.Context(), uid, []int64{itemID}); err != nil {
			serverError(w, h.log, "mark seen", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	// `unlike` toggles OFF the Like: it removes the item from the auto Liked
	// collection (#57) and nothing else. It deliberately does NOT touch item_state
	// or fire a skip - un-liking is organization, not an engagement signal, so the
	// ranker's like/skip semantics are unchanged. Logged to the append-only event
	// stream (which the ranker doesn't read) for completeness.
	if body.Type == "unlike" {
		if err := h.db.RemoveItemFromBuiltinCollection(r.Context(), uid, store.SlugLiked, itemID); err != nil {
			serverError(w, h.log, "unlike", err)
			return
		}
		iid := itemID
		_ = h.db.LogEvent(r.Context(), uid, "unlike", &iid, nil, body.SessionID, "")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	stateFor := map[string]string{
		"open": "opened", "like": "liked", "skip": "skipped",
		"save": "saved", "dismiss": "dismissed",
	}
	st, ok := stateFor[body.Type]
	if !ok {
		badRequest(w, "unknown event type")
		return
	}
	if err := h.db.SetItemState(r.Context(), uid, itemID, st); err != nil {
		serverError(w, h.log, "set item state", err)
		return
	}
	iid := itemID
	_ = h.db.LogEvent(r.Context(), uid, body.Type, &iid, nil, body.SessionID, "")
	// Wire Like -> the auto Liked collection (#57). Additive membership only: the
	// `like` state + event above are the untouched engagement signal; adding to
	// Liked is organization and never interests the ranker. A membership hiccup must
	// not fail the like, so it's a warn, not a hard error.
	if body.Type == "like" {
		if err := h.db.AddItemToBuiltinCollection(r.Context(), uid, store.SlugLiked, itemID); err != nil {
			h.log.Warn("add to liked collection", "err", err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ItemDwell records per-item dwell (#68) - how long the item was engaged before
// the user advanced, and whether they engaged at all (opened the reader/player,
// clicked through, liked, or saved). Policy, load-bearing:
//
//   - Dwell is written ONLY to the append-only `events` log (type "dwell"), never
//     to item_state. The ranker reads item_state (SourceSkipStats) and content
//     duration (SourceAvgDuration); it never reads the events log, so dwell can
//     never enter ranking or re-rank the interest. It is raw material for user-owned
//     stats (#24) and the future pacing signal (#5).
//   - The client only sends dwell when the fast-scroll check-in setting is on;
//     off = no measurement. There is no other consumer.
func (h *Handler) ItemDwell(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	itemID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad item id")
		return
	}
	var body struct {
		SessionID string `json:"session_id"`
		DwellMs   int64  `json:"dwell_ms"`
		Engaged   bool   `json:"engaged"`
	}
	if !decode(w, r, &body) {
		return
	}
	detail, _ := json.Marshal(map[string]any{"ms": body.DwellMs, "engaged": body.Engaged})
	iid := itemID
	if err := h.db.LogEvent(r.Context(), uid, "dwell", &iid, nil, body.SessionID, string(detail)); err != nil {
		serverError(w, h.log, "log dwell", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- full-text content (#98) ---

// ItemContent returns the best reader body for an item, fetching + extracting it
// on demand for interests that ship no full content (#98). Fisher's rule: attempt the
// in-app render first, fall back to "open original". Resolution:
//
//   - a stored body (content_source rss|fetched): return it as-is.
//   - already resolved to external: return external, no re-fetch.
//   - non-article media (video/audio/live): mark external without a network hit.
//   - otherwise pending: fetch the URL through readability; a real article is
//     stored as content_source=fetched, anything else is marked external.
//
// The persisted content_source is the cache: an item's URL is fetched at most
// once. This lives only on the content endpoint, never on the ingest or ranking
// path, so a slow fetch can't stall a session build (ItemEffectiveScore untouched).
func (h *Handler) ItemContent(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad item id")
		return
	}
	it, err := h.db.GetItem(r.Context(), uid, id)
	if err != nil {
		serverError(w, h.log, "get item", err)
		return
	}
	if it == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"code": "not_found", "message": "item not found"})
		return
	}

	// Already have a body: return it. content_source is rss/fetched; default a
	// legacy empty-but-populated row to rss.
	if it.Content != "" {
		src := it.ContentSource
		if src == "" {
			src = store.ContentSourceRSS
		}
		writeItemContent(w, src, it.Content, it.Summary)
		return
	}
	// Already tried and it wasn't extractable.
	if it.ContentSource == store.ContentSourceExternal {
		writeItemContent(w, store.ContentSourceExternal, "", it.Summary)
		return
	}
	// Non-article media never extracts to an article - mark external, no fetch.
	if !fetchableMedia(it.MediaType) {
		if err := h.db.SetItemContentSource(r.Context(), id, store.ContentSourceExternal); err != nil {
			h.log.Warn("mark external", "item", id, "err", err)
		}
		writeItemContent(w, store.ContentSourceExternal, "", it.Summary)
		return
	}

	// Pending: fetch + extract once. Bound the fetch independently of the request
	// so a hung origin doesn't hold the connection open to the write timeout.
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	html, ok, err := h.ft.Extract(ctx, it.URL)
	if err != nil {
		// Unexpected: return external but don't persist, so a transient failure can
		// be retried on the next open.
		h.log.Warn("full-text extract error", "item", id, "url", it.URL, "err", err)
		writeItemContent(w, store.ContentSourceExternal, "", it.Summary)
		return
	}
	if !ok {
		if err := h.db.SetItemContentSource(r.Context(), id, store.ContentSourceExternal); err != nil {
			h.log.Warn("mark external", "item", id, "err", err)
		}
		writeItemContent(w, store.ContentSourceExternal, "", it.Summary)
		return
	}
	if err := h.db.SetItemContent(r.Context(), id, html, store.ContentSourceFetched); err != nil {
		serverError(w, h.log, "store fetched content", err)
		return
	}
	writeItemContent(w, store.ContentSourceFetched, html, it.Summary)
}

// Explicit render states for GET /items/{id}/content (#99). content_source stays
// the provenance source of truth (rss|fetched|external); render is the derived,
// unambiguous engagement the card should use so #96 never has to combine
// content_source + has_full_text + media_type itself:
//
//   - renderFullText: an in-app reader body exists (rss|fetched).
//   - renderPreview:  no full text, but a teaser/summary to show inline while the
//     card links out to the original.
//   - renderExternal: no full text and nothing to preview - pure open original /
//     watch.
const (
	renderFullText = "full_text"
	renderPreview  = "preview"
	renderExternal = "external"
)

// resolveRender maps a resolved (source, content, summary) to the render state.
// A body always wins (full_text). Otherwise it's external provenance; a non-empty
// teaser makes it preview, a bare item is external.
func resolveRender(content, summary string) string {
	if strings.TrimSpace(content) != "" {
		return renderFullText
	}
	if strings.TrimSpace(summary) != "" {
		return renderPreview
	}
	return renderExternal
}

// writeItemContent is the shared shape for GET /items/{id}/content: the resolved
// body, its provenance (content_source), the derived render state, and the legacy
// has_full_text convenience flag (#96 branches on render; has_full_text kept for
// back-compat - it equals render == full_text).
func writeItemContent(w http.ResponseWriter, source, content, summary string) {
	writeJSON(w, http.StatusOK, map[string]any{
		"content_source": source,
		"content":        content,
		"has_full_text":  content != "",
		"render":         resolveRender(content, summary),
	})
}

// fetchableMedia reports whether an item's media type is a text article worth a
// readability fetch. Video/audio/live never are - they resolve straight to
// external (open original / watch) without a network hit.
func fetchableMedia(mediaType string) bool {
	switch mediaType {
	case "short", "long", "video", "audio", "live":
		return false
	default: // article, unknown, "" -> try to extract
		return true
	}
}

// --- history (#83) ---

// historyFilters is the set the History endpoint accepts. "shown" is the
// default (everything surfaced); the rest narrow to engagement.
var historyFilters = map[string]bool{"shown": true, "read": true, "liked": true, "saved": true}

// History returns the user's items newest-interaction-first with their
// interaction state + timestamp, for the personal history view (#83). Read-only:
// it joins over item_state but never writes it, and the ranker never reads
// History, so it can't move rankings. filter is one of shown|read|liked|saved
// (default shown). Pagination is limit (capped) + offset for "load more".
func (h *Handler) History(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	filter := r.URL.Query().Get("filter")
	if filter == "" {
		filter = "shown"
	}
	if !historyFilters[filter] {
		badRequest(w, "unknown filter")
		return
	}
	limit := intParam(r, "limit", 50)
	if limit < 1 {
		limit = 1
	} else if limit > 200 {
		limit = 200
	}
	offset := intParam(r, "offset", 0)
	if offset < 0 {
		offset = 0
	}
	items, err := h.db.History(r.Context(), uid, filter, limit, offset)
	if err != nil {
		serverError(w, h.log, "history", err)
		return
	}
	if items == nil {
		items = []store.HistoryItem{}
	}
	writeJSON(w, http.StatusOK, items)
}

// --- settings (#68) ---

// GetSettings returns the user's toggleable preferences (defaults applied for
// keys never written).
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	s, err := h.db.GetSettings(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "get settings", err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// UpdateSettings patches settings. Only non-nil fields are applied; the response
// is the full, current settings so the client can reconcile.
func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	var body struct {
		FastScrollCheckin *bool `json:"fast_scroll_checkin"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.FastScrollCheckin != nil {
		if err := h.db.SetFastScrollCheckin(r.Context(), uid, *body.FastScrollCheckin); err != nil {
			serverError(w, h.log, "set fast-scroll check-in", err)
			return
		}
	}
	s, err := h.db.GetSettings(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "get settings", err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// --- appearance preferences (#80/#81/#82) ---
//
// Display-only preferences: reader typography, card styling, and the intent-page
// session-length presets. Stored as a JSON blob in kv (store.Preferences). These
// never touch the ranker or the session builder - they only shape presentation,
// so a change here can't re-rank or re-select content.

// GetPreferences returns the user's appearance preferences, merged onto the
// server-side defaults (a fresh user gets today's look).
func (h *Handler) GetPreferences(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	p, err := h.db.GetPreferences(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "get preferences", err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// UpdatePreferences merges the JSON body onto the user's current preferences and
// persists them, returning the full clamped result. Merge semantics: the body
// only needs the fields it changes. The raw body is passed through so a partial
// patch preserves untouched fields (see store.UpdatePreferences).
func (h *Handler) UpdatePreferences(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	if err != nil {
		badRequest(w, "invalid body")
		return
	}
	// Reject a non-object body early so a stray array/string can't clobber the blob.
	if len(body) > 0 && !json.Valid(body) {
		badRequest(w, "invalid json body")
		return
	}
	p, err := h.db.UpdatePreferences(r.Context(), uid, body)
	if err != nil {
		serverError(w, h.log, "update preferences", err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// FetchNow triggers an on-demand ingest of all the user's sources.
func (h *Handler) FetchNow(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	n, err := h.ing.FetchAll(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "fetch all", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"new_items": n})
}

// --- helpers ---

func userID(r *http.Request) int64 {
	return middleware.IdentityFrom(r.Context()).UserID
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		badRequest(w, "invalid json body")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func badRequest(w http.ResponseWriter, msg string) {
	writeJSON(w, http.StatusBadRequest, map[string]any{"code": "bad_request", "message": msg})
}

func serverError(w http.ResponseWriter, log *slog.Logger, ctx string, err error) {
	log.Error(ctx+" failed", "err", err)
	writeJSON(w, http.StatusInternalServerError, map[string]any{"code": "server_error", "message": ctx + " failed"})
}

func intParam(r *http.Request, key string, def int) int {
	if v := r.URL.Query().Get(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			b.WriteRune('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

func randID() string {
	b := make([]byte, 9)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
