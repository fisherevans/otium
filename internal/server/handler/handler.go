// Package handler implements otium's HTTP API. Handlers are thin: parse, call
// the store or the session builder, encode JSON. The interesting logic lives in
// internal/server/session (ranking) and internal/server/feeds (ingest).
package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/fisherevans/otium/internal/server/feeds"
	"github.com/fisherevans/otium/internal/server/middleware"
	"github.com/fisherevans/otium/internal/server/session"
	"github.com/fisherevans/otium/internal/server/store"
)

type Handler struct {
	db  *store.DB
	ing *feeds.Ingester
	log *slog.Logger
}

func New(db *store.DB, ing *feeds.Ingester, log *slog.Logger) *Handler {
	return &Handler{db: db, ing: ing, log: log}
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

// --- feeds ---

func (h *Handler) ListFeeds(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	feeds, err := h.db.ListFeeds(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "list feeds", err)
		return
	}
	writeJSON(w, http.StatusOK, feeds)
}

func (h *Handler) CreateFeed(w http.ResponseWriter, r *http.Request) {
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
	f, err := h.db.CreateFeed(r.Context(), uid, body.Name, body.Slug, body.Color)
	if err != nil {
		serverError(w, h.log, "create feed", err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

// UpdateFeed patches a feed's presentation fields (name, color, icon) and its
// per-feed ranker overrides (half-life, diversity - #17). Used by the library's
// feed-settings sheet. No engagement signal - pure curation.
func (h *Handler) UpdateFeed(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad feed id")
		return
	}
	var body struct {
		Name         *string  `json:"name"`
		Color        *string  `json:"color"`
		Icon         *string  `json:"icon"`
		HalfLifeDays *float64 `json:"half_life_days"`
		Diversity    *int     `json:"diversity"`
	}
	if !decode(w, r, &body) {
		return
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
	if body.Diversity != nil {
		v := *body.Diversity
		if v < 0 {
			v = 0
		} else if v > 10 {
			v = 10
		}
		body.Diversity = &v
	}
	if err := h.db.UpdateFeed(r.Context(), uid, id, body.Name, body.Color, body.Icon, body.HalfLifeDays, body.Diversity); err != nil {
		serverError(w, h.log, "update feed", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) SetFeedSources(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	feedID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad feed id")
		return
	}
	var body struct {
		SourceIDs []int64 `json:"source_ids"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := h.db.SetFeedSources(r.Context(), uid, feedID, body.SourceIDs); err != nil {
		serverError(w, h.log, "set feed sources", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// FeedItems returns recent items across a feed's sources (by feed id), backing
// the feed page's posts section (#66).
func (h *Handler) FeedItems(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad feed id")
		return
	}
	limit := intParam(r, "limit", 50)
	items, err := h.db.ListRecentItemsByFeed(r.Context(), uid, id, limit)
	if err != nil {
		serverError(w, h.log, "feed items", err)
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

func (h *Handler) CreateSource(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	var body struct {
		Kind    string  `json:"kind"`
		Title   string  `json:"title"`
		FeedURL string  `json:"feed_url"`
		Weight  float64 `json:"weight"`
		State   string  `json:"state"`
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
	writeJSON(w, http.StatusCreated, created)
}

func (h *Handler) UpdateSource(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad source id")
		return
	}
	var body struct {
		Weight *float64 `json:"weight"`
		Bucket *string  `json:"weight_bucket"`
		State  *string  `json:"state"`
		Cap    *int     `json:"per_session_cap"`
		Title  *string  `json:"title"`
	}
	if !decode(w, r, &body) {
		return
	}
	weight := body.Weight
	if body.Bucket != nil {
		wf, err := session.WeightForBucket(*body.Bucket)
		if err != nil {
			badRequest(w, err.Error())
			return
		}
		weight = &wf
	}
	if err := h.db.UpdateSource(r.Context(), uid, id, weight, body.State, body.Cap, body.Title); err != nil {
		serverError(w, h.log, "update source", err)
		return
	}
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

// SetSourceFeeds replaces the set of feeds (themes) a source belongs to.
func (h *Handler) SetSourceFeeds(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad source id")
		return
	}
	var body struct {
		FeedSlugs []string `json:"feed_slugs"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := h.db.SetSourceFeeds(r.Context(), uid, id, body.FeedSlugs); err != nil {
		serverError(w, h.log, "set source feeds", err)
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
	items, err := h.db.ListRecentItemsBySource(r.Context(), uid, id, limit)
	if err != nil {
		serverError(w, h.log, "source items", err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// --- sessions ---
//
// Sessions are durable and stateful (#67). CreateSession builds a finite queue
// from a single duration + themes (#69), stores it, and returns it; the queue
// and the read cursor live in the backend so a refresh or a return resumes the
// same items at the same place (CurrentSession) rather than rebuilding a fresh
// feed. One session per user is active at a time - creating a new one ends the
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
		Themes      []string `json:"themes"` // feed slugs; empty = all followed sources
	}
	if !decode(w, r, &body) {
		return
	}
	if body.DurationMin <= 0 {
		body.DurationMin = 15
	}

	items, err := h.buildSessionQueue(r.Context(), uid, body.DurationMin, body.Themes)
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

// buildSessionQueue resolves themes, pulls the candidate pool + behavioral
// stats, runs the ranker for the single duration (fed as both bounds so the
// existing predict/selectivity path is unchanged), and attaches each item's
// primary feed. Returns an empty slice when the theme selection has no sources.
func (h *Handler) buildSessionQueue(ctx context.Context, uid int64, durationMin int, themes []string) ([]session.Selected, error) {
	var sourceIDs []int64
	if len(themes) > 0 {
		ids, err := h.db.SourceIDsForFeeds(ctx, uid, themes)
		if err != nil {
			return nil, err
		}
		// A theme with no sources yields an empty session, not "all".
		if len(ids) == 0 {
			return nil, nil
		}
		sourceIDs = ids
	}

	pool, err := h.db.Candidates(ctx, uid, sourceIDs, 45, 500)
	if err != nil {
		return nil, err
	}
	stats, err := h.sourceStats(ctx, uid)
	if err != nil {
		return nil, err
	}
	// Single duration (#69): pass it as both bounds. predictItems averages the two,
	// so low==high just means "exactly this many minutes" - no range/variability.
	result := session.Build(session.Request{MinLow: durationMin, MinHigh: durationMin}, pool, time.Now().UTC(), stats)
	h.attachFeeds(ctx, uid, result.Items)
	return result.Items, nil
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
	stats, err := h.sourceStats(ctx, uid)
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
		out = append(out, session.SelectFor(c, now, stats[c.SourceID]))
	}
	h.attachFeeds(ctx, uid, out)
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

// attachFeeds fills each item's primary feed identity for the card's identity
// line. Feedless sources (e.g. a YouTube channel) stay nil and render source-only.
func (h *Handler) attachFeeds(ctx context.Context, uid int64, items []session.Selected) {
	if len(items) == 0 {
		return
	}
	ids := make([]int64, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.Item.SourceID)
	}
	primaries, err := h.db.PrimaryFeedsForSources(ctx, uid, ids)
	if err != nil {
		h.log.Warn("resolve primary feeds", "err", err)
		return
	}
	for i := range items {
		if f, ok := primaries[items[i].Item.SourceID]; ok {
			fc := f
			items[i].Feed = &fc
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
	// Liked is organization and never feeds the ranker. A membership hiccup must
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
//     never enter ranking or re-rank the feed. It is raw material for user-owned
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
