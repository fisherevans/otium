package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/fisherevans/otium/internal/server/store"
	"github.com/go-chi/chi/v5"
)

// Saved session presets, mixes included (#203). The server is the source of
// truth so presets follow the account and agents can manage them; the browser
// keeps a cache and syncs. Setups are validated here with the same rules as the
// client's normalizeSetup (web/src/lib/sessionPresets.ts).

type presetSetup struct {
	Minutes      int        `json:"minutes"`
	Sections     []string   `json:"sections"`
	Excluded     []string   `json:"excluded"`
	ContentTypes []string   `json:"contentTypes"`
	Mix          *presetMix `json:"mix,omitempty"`
}

type presetMix struct {
	Formats  map[string]float64 `json:"formats"`
	Sections map[string]float64 `json:"sections"`
}

var (
	presetContentTypes = map[string]bool{"article": true, "long": true, "short": true}
	presetMixFormats   = map[string]bool{"article": true, "post": true, "short": true, "long": true}
	presetMixWeights   = map[float64]bool{0: true, 0.5: true, 1: true, 2: true}
)

// normalizePreset validates one preset and returns it with a canonical setup.
// A mix's content types are derived from its shares, as the client does.
func normalizePreset(p store.SessionPreset) (store.SessionPreset, error) {
	p.ID = strings.TrimSpace(p.ID)
	p.Name = strings.TrimSpace(p.Name)
	if p.ID == "" || len(p.ID) > 64 {
		return p, fmt.Errorf("preset id is required (1-64 characters)")
	}
	if p.Name == "" {
		return p, fmt.Errorf("preset %q needs a name", p.ID)
	}
	if len(p.Name) > 80 {
		p.Name = p.Name[:80]
	}
	var s presetSetup
	if err := json.Unmarshal(p.Setup, &s); err != nil {
		return p, fmt.Errorf("preset %q: setup is not valid JSON", p.ID)
	}
	if s.Minutes < 5 || s.Minutes > 120 {
		return p, fmt.Errorf("preset %q: minutes must be 5-120", p.ID)
	}
	if s.Sections == nil {
		s.Sections = []string{}
	}
	if s.Excluded == nil {
		s.Excluded = []string{}
	}
	if s.Mix != nil {
		total := 0.0
		for f, share := range s.Mix.Formats {
			if !presetMixFormats[f] || share < 0 || share > 1000 {
				return p, fmt.Errorf("preset %q: mix format %q must be article, post, short or long with a share 0-1000", p.ID, f)
			}
			total += share
		}
		if total <= 0 {
			return p, fmt.Errorf("preset %q: give at least one format a share", p.ID)
		}
		if s.Mix.Sections == nil {
			s.Mix.Sections = map[string]float64{}
		}
		for slug, w := range s.Mix.Sections {
			if !presetMixWeights[w] {
				return p, fmt.Errorf("preset %q: section %q weight must be 0, 0.5, 1 or 2", p.ID, slug)
			}
		}
		// A mix spans every section; shares decide content.
		s.Sections, s.Excluded = []string{}, []string{}
		s.ContentTypes = nil
		for _, t := range []string{"article", "long", "short"} {
			if s.Mix.Formats[t] > 0 || (t == "article" && s.Mix.Formats["post"] > 0) {
				s.ContentTypes = append(s.ContentTypes, t)
			}
		}
	} else {
		if len(s.ContentTypes) == 0 {
			return p, fmt.Errorf("preset %q: choose at least one content type", p.ID)
		}
		for _, t := range s.ContentTypes {
			if !presetContentTypes[t] {
				return p, fmt.Errorf("preset %q: content type %q must be article, long or short", p.ID, t)
			}
		}
	}
	raw, err := json.Marshal(s)
	if err != nil {
		return p, err
	}
	p.Setup = raw
	return p, nil
}

func (h *Handler) writePresets(w http.ResponseWriter, r *http.Request) {
	presets, def, init, err := h.db.ListPresets(r.Context(), userID(r))
	if err != nil {
		serverError(w, h.log, "list presets", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"presets": presets, "default_id": def, "initialized": init})
}

// ListPresets serves the browser sync and agents alike.
func (h *Handler) ListPresets(w http.ResponseWriter, r *http.Request) { h.writePresets(w, r) }

// ReplacePresets is the browser's sync: the full ordered list plus the default.
func (h *Handler) ReplacePresets(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Presets   []store.SessionPreset `json:"presets"`
		DefaultID string                `json:"default_id"`
	}
	if !decode(w, r, &body) {
		return
	}
	seen := map[string]bool{}
	clean := make([]store.SessionPreset, 0, len(body.Presets))
	for _, p := range body.Presets {
		n, err := normalizePreset(p)
		if err != nil {
			badRequest(w, err.Error())
			return
		}
		if seen[n.ID] {
			badRequest(w, "duplicate preset id "+n.ID)
			return
		}
		seen[n.ID] = true
		clean = append(clean, n)
	}
	if body.DefaultID != "" && !seen[body.DefaultID] {
		badRequest(w, "default_id is not one of the presets")
		return
	}
	if err := h.db.ReplacePresets(r.Context(), userID(r), clean, body.DefaultID); err != nil {
		serverError(w, h.log, "replace presets", err)
		return
	}
	h.writePresets(w, r)
}

// PutPreset creates or replaces one preset by id (agents). ?default=1 also makes
// it the default.
func (h *Handler) PutPreset(w http.ResponseWriter, r *http.Request) {
	var p store.SessionPreset
	if !decode(w, r, &p) {
		return
	}
	p.ID = chi.URLParam(r, "id")
	n, err := normalizePreset(p)
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	if err := h.db.UpsertPreset(r.Context(), userID(r), n, r.URL.Query().Get("default") == "1"); err != nil {
		serverError(w, h.log, "upsert preset", err)
		return
	}
	h.writePresets(w, r)
}

func (h *Handler) DeletePreset(w http.ResponseWriter, r *http.Request) {
	ok, err := h.db.DeletePreset(r.Context(), userID(r), chi.URLParam(r, "id"))
	if err != nil {
		serverError(w, h.log, "delete preset", err)
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"code": "not_found", "message": "preset not found"})
		return
	}
	h.writePresets(w, r)
}
