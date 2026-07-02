// Package handler implements otium's HTTP API. Handlers are thin: parse, call
// the store or the session builder, encode JSON. The interesting logic lives in
// internal/server/session (ranking) and internal/server/feeds (ingest).
package handler

import (
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

// BuildSession is the core endpoint: turn a duration range + themes into a
// finite, ordered, explainable set of items.
func (h *Handler) BuildSession(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	var body struct {
		MinLow  int      `json:"min_low"`
		MinHigh int      `json:"min_high"`
		Themes  []string `json:"themes"` // feed slugs; empty = all followed sources
	}
	if !decode(w, r, &body) {
		return
	}
	if body.MinLow <= 0 {
		body.MinLow = 5
	}
	if body.MinHigh < body.MinLow {
		body.MinHigh = body.MinLow
	}

	var sourceIDs []int64
	if len(body.Themes) > 0 {
		ids, err := h.db.SourceIDsForFeeds(r.Context(), uid, body.Themes)
		if err != nil {
			serverError(w, h.log, "resolve themes", err)
			return
		}
		// A theme with no sources should yield an empty session, not "all".
		sourceIDs = ids
		if len(sourceIDs) == 0 {
			writeJSON(w, http.StatusOK, session.Result{TargetLow: body.MinLow, TargetHigh: body.MinHigh})
			return
		}
	}

	// Pull a generous candidate pool (recent unseen), rank, and fill.
	pool, err := h.db.Candidates(r.Context(), uid, sourceIDs, 45, 500)
	if err != nil {
		serverError(w, h.log, "candidates", err)
		return
	}

	// Behavioral + content signals: empirical time-per-item (predicts how many
	// items fit the budget -> selectivity) and skip history (downweights sources
	// the user keeps passing on).
	avgDur, err := h.db.SourceAvgDuration(r.Context(), uid, 100)
	if err != nil {
		serverError(w, h.log, "avg duration", err)
		return
	}
	skips, err := h.db.SourceSkipStats(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "skip stats", err)
		return
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

	result := session.Build(session.Request{MinLow: body.MinLow, MinHigh: body.MinHigh}, pool, time.Now().UTC(), stats)

	// Persist the session and mark its items surfaced so the next build doesn't
	// repeat them.
	sid := randID()
	ids := make([]int64, len(result.Items))
	for i, it := range result.Items {
		ids[i] = it.Item.ID
	}
	if err := h.db.SaveSession(r.Context(), sid, uid, body.MinLow, body.MinHigh, strings.Join(body.Themes, ","), ids); err != nil {
		h.log.Warn("save session failed", "err", err)
	}
	// Items are NOT marked surfaced here - the queue is paced client-side, so an
	// item is only "seen" once it actually reaches the user (a `seen` event).
	// Otherwise a staged-but-unconsumed item would be burned.
	_ = h.db.LogEvent(r.Context(), uid, "session_build", nil, nil, sid,
		`{"count":`+strconv.Itoa(len(ids))+`,"themes":"`+strings.Join(body.Themes, ",")+`"}`)

	writeJSON(w, http.StatusOK, map[string]any{"session_id": sid, "result": result})
}

// ItemEvent records an interaction (open/like/skip/save/dismiss) and updates the
// item's state. Explicit signals only - no dwell/scroll tracking.
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
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
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
