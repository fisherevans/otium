package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/fisherevans/otium/internal/server/store"
	"github.com/go-chi/chi/v5"
)

// Sections (#86) are a user-created overlay grouping topics many-to-many. These
// handlers are thin CRUD + topic-assignment + a browse endpoint that returns a
// section's topics and the sources aggregated across them.

func (h *Handler) ListSections(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	sections, err := h.db.ListSections(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "list sections", err)
		return
	}
	if sections == nil {
		sections = []store.Section{}
	}
	writeJSON(w, http.StatusOK, sections)
}

func (h *Handler) CreateSection(w http.ResponseWriter, r *http.Request) {
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
	g, err := h.db.CreateSection(r.Context(), uid, body.Name, slugify(body.Name), body.Icon)
	if err != nil {
		serverError(w, h.log, "create section", err)
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (h *Handler) UpdateSection(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad section id")
		return
	}
	var body struct {
		Name *string `json:"name"`
		Icon *string `json:"icon"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := h.db.UpdateSection(r.Context(), uid, id, body.Name, body.Icon); err != nil {
		if errors.Is(err, store.ErrSectionNotFound) {
			badRequest(w, "section not found")
			return
		}
		serverError(w, h.log, "update section", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) DeleteSection(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad section id")
		return
	}
	if err := h.db.DeleteSection(r.Context(), uid, id); err != nil {
		if errors.Is(err, store.ErrSectionNotFound) {
			badRequest(w, "section not found")
			return
		}
		serverError(w, h.log, "delete section", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// SetSectionTopics replaces the topics in a section with exactly topic_ids.
func (h *Handler) SetSectionTopics(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad section id")
		return
	}
	var body struct {
		TopicIDs []int64 `json:"topic_ids"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := h.db.SetSectionTopics(r.Context(), uid, id, body.TopicIDs); err != nil {
		if errors.Is(err, store.ErrSectionNotFound) {
			badRequest(w, "section not found")
			return
		}
		serverError(w, h.log, "set section topics", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// SectionBrowse returns a section with its member topics and the sources aggregated
// across those topics (#86), for the Section -> Topic -> Source browse. The section is
// addressed by id (matching the PATCH/DELETE/PUT routes' wildcard name).
func (h *Handler) SectionBrowse(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad section id")
		return
	}
	topics, err := h.db.SectionTopics(r.Context(), uid, id)
	if err != nil {
		serverError(w, h.log, "section topics", err)
		return
	}
	if topics == nil {
		topics = []store.Topic{}
	}
	// Aggregate the sources across the section's topics, reusing ListSources so each
	// carries its full UI facts (weight, unseen, topic_slug).
	inSection := map[string]bool{}
	for _, f := range topics {
		inSection[f.Slug] = true
	}
	all, err := h.db.ListSources(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "section sources", err)
		return
	}
	sources := make([]store.Source, 0)
	for _, s := range all {
		if s.TopicSlug != "" && inSection[s.TopicSlug] {
			sources = append(sources, s)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"topics":  topics,
		"sources": sources,
	})
}
