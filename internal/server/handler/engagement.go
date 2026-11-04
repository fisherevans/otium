package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/fisherevans/otium/internal/server/session"
	"github.com/fisherevans/otium/internal/server/store"
	"github.com/go-chi/chi/v5"
)

// Engagement (#196): like/dislike signals and per-view metrics, read back as a
// per-channel or per-tag rollup. Descriptive only; the session engine never
// reads any of it.

// ItemSignal sets or clears the item's like/dislike. Body {"signal": "like" |
// "dislike" | ""}; the response carries the signal now in effect.
func (h *Handler) ItemSignal(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	itemID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad item id")
		return
	}
	var body struct {
		Signal string `json:"signal"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Signal != "" && body.Signal != "like" && body.Signal != "dislike" {
		badRequest(w, "signal must be like, dislike or empty")
		return
	}
	got, err := h.db.SetItemSignal(r.Context(), uid, itemID, body.Signal)
	if errors.Is(err, store.ErrItemNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]any{"code": "not_found", "message": "item not found"})
		return
	}
	if err != nil {
		serverError(w, h.log, "set signal", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"signal": got})
}

// ItemView records one time an item was on screen. The client sends running
// totals under a view key, so a repeat (advance, then pagehide) replaces the
// earlier write. Accepts sendBeacon's text/plain body.
func (h *Handler) ItemView(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	itemID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad item id")
		return
	}
	var v store.ItemView
	if !decode(w, r, &v) {
		return
	}
	if v.ViewKey == "" || len(v.ViewKey) > 120 {
		badRequest(w, "view_key required")
		return
	}
	err = h.db.RecordItemView(r.Context(), uid, itemID, v)
	if errors.Is(err, store.ErrItemNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]any{"code": "not_found", "message": "item not found"})
		return
	}
	if err != nil {
		serverError(w, h.log, "record view", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Engagement returns the rollup for a range: ?by=source|tag, and either
// ?days=N (default 30, ending now) or ?from=YYYY-MM-DD&to=YYYY-MM-DD (to is
// inclusive). Served to the app and, read-only, to the agent API.
func (h *Handler) Engagement(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	to := time.Now().UTC()
	from := to.AddDate(0, 0, -intParam(r, "days", 30))
	q := r.URL.Query()
	if s := q.Get("from"); s != "" {
		t, err := time.Parse(time.DateOnly, s)
		if err != nil {
			badRequest(w, "from must be YYYY-MM-DD")
			return
		}
		from = t
	}
	if s := q.Get("to"); s != "" {
		t, err := time.Parse(time.DateOnly, s)
		if err != nil {
			badRequest(w, "to must be YYYY-MM-DD")
			return
		}
		to = t.AddDate(0, 0, 1)
	}
	rep, err := h.db.Engagement(r.Context(), uid, from, to, q.Get("by"))
	if err != nil {
		serverError(w, h.log, "engagement", err)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

// attachSignals marks each queued item with its current like/dislike, so the
// card and reader show it.
func (h *Handler) attachSignals(ctx context.Context, uid int64, items []session.Selected) {
	if len(items) == 0 {
		return
	}
	ids := make([]int64, len(items))
	for i, it := range items {
		ids[i] = it.Item.ID
	}
	sig, err := h.db.ItemSignals(ctx, uid, ids)
	if err != nil {
		h.log.Warn("item signals", "err", err)
		return
	}
	for i := range items {
		items[i].Item.Signal = sig[items[i].Item.ID]
	}
}
