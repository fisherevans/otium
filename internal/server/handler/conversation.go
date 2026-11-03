package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/fisherevans/otium/internal/server/conversation"
	"github.com/go-chi/chi/v5"
)

// SetConversation enables GET /items/{id}/conversation (#200).
func (h *Handler) SetConversation(s *conversation.Service) { h.conv = s }

// ItemConversation returns the public conversation around an item: replies and
// quotes for a Bluesky post, comments for a Substack post, top comments for a
// YouTube video. 204 means the item has none otium can fetch, so the client
// stops asking; a failed upstream is 502 and the card simply shows nothing.
func (h *Handler) ItemConversation(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad item id")
		return
	}
	t, err := h.db.GetConversationTarget(r.Context(), userID(r), id)
	if err != nil {
		serverError(w, h.log, "conversation target", err)
		return
	}
	if t == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"code": "not_found", "message": "item not found"})
		return
	}
	target := conversation.Target{Kind: t.SourceKind, FeedURL: t.FeedURL, URL: t.URL, ExternalID: t.ExternalID}
	if h.conv == nil || !h.conv.Supported(target) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	conv, err := h.conv.Get(r.Context(), target)
	if errors.Is(err, conversation.ErrUnsupported) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		if r.Context().Err() == nil {
			h.log.Warn("conversation fetch failed", "item", id, "err", err)
		}
		writeJSON(w, http.StatusBadGateway, map[string]any{"code": "upstream", "message": "the conversation couldn't be loaded"})
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=120")
	writeJSON(w, http.StatusOK, conv)
}
