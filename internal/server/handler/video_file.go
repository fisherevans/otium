package handler

import (
	"errors"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/fisherevans/otium/internal/server/videofile"
	"github.com/go-chi/chi/v5"
)

var unsafeFilename = regexp.MustCompile(`[^A-Za-z0-9 ._-]+`)

// ItemVideo serves a short video item as an MP4 file (#180) so the phone can save
// or share the clip itself, not a link. ?download=1 marks it as an attachment.
// The first request for a clip waits for yt-dlp (typically a few seconds); later
// requests come from the on-disk cache.
func (h *Handler) ItemVideo(w http.ResponseWriter, r *http.Request) {
	if h.video == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"code": "unavailable", "message": "video downloads are not enabled"})
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		badRequest(w, "bad item id")
		return
	}
	it, err := h.db.GetItem(r.Context(), userID(r), id)
	if err != nil {
		serverError(w, h.log, "get item", err)
		return
	}
	if it == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"code": "not_found", "message": "item not found"})
		return
	}
	if it.MediaType != "short" && (it.DurationSec <= 0 || it.DurationSec > videofile.MaxDurationSec) {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"code": "too_long", "message": "only short videos can be downloaded"})
		return
	}
	vid, err := videofile.YouTubeID(it.URL)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"code": "unsupported", "message": "only YouTube videos can be downloaded"})
		return
	}
	path, err := h.video.Fetch(r.Context(), vid)
	if err != nil {
		if errors.Is(err, videofile.ErrUnavailable) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"code": "unavailable", "message": err.Error()})
			return
		}
		if r.Context().Err() != nil {
			return
		}
		h.log.Warn("video download failed", "item", id, "video", vid, "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"code": "download_failed", "message": "YouTube didn't provide this video"})
		return
	}
	f, err := os.Open(path)
	if err != nil {
		serverError(w, h.log, "open video", err)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		serverError(w, h.log, "stat video", err)
		return
	}
	name := strings.TrimSpace(unsafeFilename.ReplaceAllString(it.Title, ""))
	if len(name) > 60 {
		name = strings.TrimSpace(name[:60])
	}
	if name == "" {
		name = vid
	}
	disposition := "inline"
	if r.URL.Query().Get("download") == "1" {
		disposition = "attachment"
	}
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Content-Disposition", disposition+`; filename="`+name+`.mp4"`)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeContent(w, r, name+".mp4", st.ModTime(), f)
}
