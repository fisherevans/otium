package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/fisherevans/otium/internal/server/store"
	"github.com/go-chi/chi/v5"
)

// Groups (#86) are a user-created overlay grouping feeds many-to-many. These
// handlers are thin CRUD + feed-assignment + a browse endpoint that returns a
// group's feeds and the sources aggregated across them.

func (h *Handler) ListGroups(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	groups, err := h.db.ListGroups(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "list groups", err)
		return
	}
	if groups == nil {
		groups = []store.Group{}
	}
	writeJSON(w, http.StatusOK, groups)
}

func (h *Handler) CreateGroup(w http.ResponseWriter, r *http.Request) {
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
	g, err := h.db.CreateGroup(r.Context(), uid, body.Name, slugify(body.Name), body.Icon)
	if err != nil {
		serverError(w, h.log, "create group", err)
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (h *Handler) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad group id")
		return
	}
	var body struct {
		Name *string `json:"name"`
		Icon *string `json:"icon"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := h.db.UpdateGroup(r.Context(), uid, id, body.Name, body.Icon); err != nil {
		if errors.Is(err, store.ErrGroupNotFound) {
			badRequest(w, "group not found")
			return
		}
		serverError(w, h.log, "update group", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad group id")
		return
	}
	if err := h.db.DeleteGroup(r.Context(), uid, id); err != nil {
		if errors.Is(err, store.ErrGroupNotFound) {
			badRequest(w, "group not found")
			return
		}
		serverError(w, h.log, "delete group", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// SetGroupFeeds replaces the feeds in a group with exactly feed_ids.
func (h *Handler) SetGroupFeeds(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad group id")
		return
	}
	var body struct {
		FeedIDs []int64 `json:"feed_ids"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := h.db.SetGroupFeeds(r.Context(), uid, id, body.FeedIDs); err != nil {
		if errors.Is(err, store.ErrGroupNotFound) {
			badRequest(w, "group not found")
			return
		}
		serverError(w, h.log, "set group feeds", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GroupBrowse returns a group with its member feeds and the sources aggregated
// across those feeds (#86), for the Group -> Feed -> Source browse. The group is
// addressed by id (matching the PATCH/DELETE/PUT routes' wildcard name).
func (h *Handler) GroupBrowse(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad group id")
		return
	}
	feeds, err := h.db.GroupFeeds(r.Context(), uid, id)
	if err != nil {
		serverError(w, h.log, "group feeds", err)
		return
	}
	if feeds == nil {
		feeds = []store.Feed{}
	}
	// Aggregate the sources across the group's feeds, reusing ListSources so each
	// carries its full UI facts (weight, unseen, feed_slug).
	inGroup := map[string]bool{}
	for _, f := range feeds {
		inGroup[f.Slug] = true
	}
	all, err := h.db.ListSources(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "group sources", err)
		return
	}
	sources := make([]store.Source, 0)
	for _, s := range all {
		if s.FeedSlug != "" && inGroup[s.FeedSlug] {
			sources = append(sources, s)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"feeds":   feeds,
		"sources": sources,
	})
}
