package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/fisherevans/otium/internal/server/store"
)

// Collections (#57): named lists of saved items. Builtins (Saved, Watch Later,
// Liked) are seeded on first access; the rest are user-created. Membership is
// organization only - none of these endpoints emit an engagement event or touch
// item_state, so the ranker is unaffected.

// ListCollections lists the user's collections with counts. ?item_id=N adds a
// per-collection `contains` flag for the Save picker's membership checkmarks.
func (h *Handler) ListCollections(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	if err := h.db.EnsureBuiltinCollections(r.Context(), uid); err != nil {
		serverError(w, h.log, "seed collections", err)
		return
	}
	itemID := int64(intParam(r, "item_id", 0))
	cols, err := h.db.ListCollections(r.Context(), uid, itemID)
	if err != nil {
		serverError(w, h.log, "list collections", err)
		return
	}
	writeJSON(w, http.StatusOK, cols)
}

func (h *Handler) CreateCollection(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	var body struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &body) {
		return
	}
	name := trimName(body.Name)
	if name == "" {
		badRequest(w, "name is required")
		return
	}
	c, err := h.db.CreateCollection(r.Context(), uid, name, slugify(name))
	if err != nil {
		serverError(w, h.log, "create collection", err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (h *Handler) RenameCollection(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &body) {
		return
	}
	name := trimName(body.Name)
	if name == "" {
		badRequest(w, "name is required")
		return
	}
	if err := h.db.RenameCollection(r.Context(), uid, id, name); err != nil {
		if errors.Is(err, store.ErrCollectionProtected) {
			badRequest(w, "that collection can't be renamed")
			return
		}
		serverError(w, h.log, "rename collection", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) DeleteCollection(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	if err := h.db.DeleteCollection(r.Context(), uid, id); err != nil {
		if errors.Is(err, store.ErrCollectionProtected) {
			badRequest(w, "that collection can't be deleted")
			return
		}
		serverError(w, h.log, "delete collection", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) CollectionItems(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	items, err := h.db.CollectionItems(r.Context(), uid, id)
	if err != nil {
		serverError(w, h.log, "collection items", err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) AddCollectionItem(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	var body struct {
		ItemID int64 `json:"item_id"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.ItemID <= 0 {
		badRequest(w, "item_id is required")
		return
	}
	if err := h.db.AddItemToCollection(r.Context(), uid, id, body.ItemID); err != nil {
		if errors.Is(err, store.ErrCollectionProtected) {
			badRequest(w, "no such collection")
			return
		}
		serverError(w, h.log, "add collection item", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) RemoveCollectionItem(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	id, ok := idParam(w, r)
	if !ok {
		return
	}
	itemID, err := strconv.ParseInt(chi.URLParam(r, "itemId"), 10, 64)
	if err != nil {
		badRequest(w, "bad item id")
		return
	}
	if err := h.db.RemoveItemFromCollection(r.Context(), uid, id, itemID); err != nil {
		if errors.Is(err, store.ErrCollectionProtected) {
			badRequest(w, "no such collection")
			return
		}
		serverError(w, h.log, "remove collection item", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// idParam parses the {id} path param, writing a 400 and returning ok=false on a
// bad value.
func idParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad collection id")
		return 0, false
	}
	return id, true
}

func trimName(s string) string {
	// Reuse the same trimming the rest of the API applies; a collection name is
	// free text, just trimmed of surrounding whitespace.
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t' || s[0] == '\n') {
		s = s[1:]
	}
	for len(s) > 0 {
		c := s[len(s)-1]
		if c == ' ' || c == '\t' || c == '\n' {
			s = s[:len(s)-1]
			continue
		}
		break
	}
	return s
}
