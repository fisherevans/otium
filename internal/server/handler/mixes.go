package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/fisherevans/otium/internal/server/store"
	"github.com/go-chi/chi/v5"
)

// Mixes (#86) are a user-created overlay grouping interests many-to-many. These
// handlers are thin CRUD + interest-assignment + a browse endpoint that returns a
// mix's interests and the sources aggregated across them.

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

// SetMixInterests replaces the interests in a mix with exactly interest_ids.
func (h *Handler) SetMixInterests(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad mix id")
		return
	}
	var body struct {
		InterestIDs []int64 `json:"interest_ids"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := h.db.SetMixInterests(r.Context(), uid, id, body.InterestIDs); err != nil {
		if errors.Is(err, store.ErrMixNotFound) {
			badRequest(w, "mix not found")
			return
		}
		serverError(w, h.log, "set mix interests", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// MixBrowse returns a mix with its member interests and the sources aggregated
// across those interests (#86), for the Mix -> Interest -> Source browse. The mix is
// addressed by id (matching the PATCH/DELETE/PUT routes' wildcard name).
func (h *Handler) MixBrowse(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad mix id")
		return
	}
	interests, err := h.db.MixInterests(r.Context(), uid, id)
	if err != nil {
		serverError(w, h.log, "mix interests", err)
		return
	}
	if interests == nil {
		interests = []store.Interest{}
	}
	// Aggregate the sources across the mix's interests, reusing ListSources so each
	// carries its full UI facts (weight, unseen, interest_slug).
	inMix := map[string]bool{}
	for _, f := range interests {
		inMix[f.Slug] = true
	}
	all, err := h.db.ListSources(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "mix sources", err)
		return
	}
	sources := make([]store.Source, 0)
	for _, s := range all {
		if s.InterestSlug != "" && inMix[s.InterestSlug] {
			sources = append(sources, s)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"interests": interests,
		"sources":   sources,
	})
}
