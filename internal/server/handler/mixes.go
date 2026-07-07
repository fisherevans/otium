package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/fisherevans/otium/internal/server/store"
	"github.com/go-chi/chi/v5"
)

// Mixes (#86) are a user-created overlay grouping feeds many-to-many. These
// handlers are thin CRUD + feed-assignment + a browse endpoint that returns a
// mix's feeds and the sources aggregated across them.

func (h *Handler) ListMixes(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	mixes, err := h.db.ListMixes(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "list mixes", err)
		return
	}
	if mixes == nil {
		mixes = []store.Mix{}
	}
	writeJSON(w, http.StatusOK, mixes)
}

func (h *Handler) CreateMix(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	var body struct {
		Name string `json:"name"`
		Icon string `json:"icon"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Name == "" {
		badRequest(w, "name is required")
		return
	}
	g, err := h.db.CreateMix(r.Context(), uid, body.Name, slugify(body.Name), body.Icon)
	if err != nil {
		serverError(w, h.log, "create mix", err)
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (h *Handler) UpdateMix(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad mix id")
		return
	}
	var body struct {
		Name *string `json:"name"`
		Icon *string `json:"icon"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := h.db.UpdateMix(r.Context(), uid, id, body.Name, body.Icon); err != nil {
		if errors.Is(err, store.ErrMixNotFound) {
			badRequest(w, "mix not found")
			return
		}
		serverError(w, h.log, "update mix", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) DeleteMix(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad mix id")
		return
	}
	if err := h.db.DeleteMix(r.Context(), uid, id); err != nil {
		if errors.Is(err, store.ErrMixNotFound) {
			badRequest(w, "mix not found")
			return
		}
		serverError(w, h.log, "delete mix", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// SetMixFeeds replaces the feeds in a mix with exactly feed_ids.
func (h *Handler) SetMixFeeds(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad mix id")
		return
	}
	var body struct {
		FeedIDs []int64 `json:"feed_ids"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := h.db.SetMixFeeds(r.Context(), uid, id, body.FeedIDs); err != nil {
		if errors.Is(err, store.ErrMixNotFound) {
			badRequest(w, "mix not found")
			return
		}
		serverError(w, h.log, "set mix feeds", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// MixBrowse returns a mix with its member feeds and the sources aggregated
// across those feeds (#86), for the Mix -> Feed -> Source browse. The mix is
// addressed by id (matching the PATCH/DELETE/PUT routes' wildcard name).
func (h *Handler) MixBrowse(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad mix id")
		return
	}
	feeds, err := h.db.MixFeeds(r.Context(), uid, id)
	if err != nil {
		serverError(w, h.log, "mix feeds", err)
		return
	}
	if feeds == nil {
		feeds = []store.Feed{}
	}
	// Aggregate the sources across the mix's feeds, reusing ListSources so each
	// carries its full UI facts (weight, unseen, feed_slug).
	inMix := map[string]bool{}
	for _, f := range feeds {
		inMix[f.Slug] = true
	}
	all, err := h.db.ListSources(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "mix sources", err)
		return
	}
	sources := make([]store.Source, 0)
	for _, s := range all {
		if s.FeedSlug != "" && inMix[s.FeedSlug] {
			sources = append(sources, s)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"feeds":   feeds,
		"sources": sources,
	})
}
