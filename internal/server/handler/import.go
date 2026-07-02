package handler

import (
	"context"
	"io"
	"net/http"

	"github.com/fisherevans/otium/internal/server/importer"
	"github.com/fisherevans/otium/internal/server/store"
)

const maxImportBytes = 48 << 20 // generous: a raw Takeout/export zip, not just the CSV

// ParseImport accepts a raw OPML / Takeout-CSV / URL-list body and returns the
// parsed candidates for review. It does not persist anything.
func (h *Handler) ParseImport(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(io.LimitReader(r.Body, maxImportBytes))
	if err != nil {
		badRequest(w, "could not read upload")
		return
	}
	// Unpack a zip (raw Takeout / export download) to its importable file first.
	data, err = importer.ExtractImportable(data)
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	cands, format, err := importer.Parse(data)
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"format":     format,
		"count":      len(cands),
		"candidates": cands,
	})
}

// CommitImport creates the kept candidates as sources, optionally turning their
// OPML folders into feeds. It returns immediately and refreshes the new feeds in
// the background (fetching hundreds of feeds inline would block the request).
func (h *Handler) CommitImport(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	var body struct {
		Sources           []importer.Candidate `json:"sources"`
		CreateFeedsFolders bool                `json:"create_feeds_from_folders"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.Sources) == 0 {
		badRequest(w, "no sources to import")
		return
	}

	created, skipped := 0, 0
	feedIDs := map[string]int64{}
	for _, c := range body.Sources {
		if c.FeedURL == "" {
			continue
		}
		id, isNew, err := h.db.CreateSourceImport(r.Context(), &store.Source{
			UserID:      uid,
			Kind:        c.Kind,
			Title:       c.Title,
			FeedURL:     c.FeedURL,
			HomepageURL: c.HomepageURL,
		})
		if err != nil {
			h.log.Warn("import: create source failed", "url", c.FeedURL, "err", err)
			continue
		}
		if isNew {
			created++
		} else {
			skipped++
		}
		if body.CreateFeedsFolders && c.Category != "" {
			fid, ok := feedIDs[c.Category]
			if !ok {
				f, err := h.db.GetOrCreateFeed(r.Context(), uid, c.Category, slugify(c.Category), "")
				if err != nil {
					h.log.Warn("import: feed create failed", "cat", c.Category, "err", err)
					continue
				}
				fid = f.ID
				feedIDs[c.Category] = fid
			}
			_ = h.db.AddFeedSource(r.Context(), fid, id)
		}
	}

	// Refresh in the background so items populate without blocking the response.
	go func() {
		n, err := h.ing.FetchAll(context.Background(), uid)
		if err != nil {
			h.log.Warn("import: background fetch failed", "err", err)
			return
		}
		h.log.Info("import: background fetch done", "new_items", n)
	}()

	writeJSON(w, http.StatusOK, map[string]any{
		"created":       created,
		"already_had":   skipped,
		"feeds_created": len(feedIDs),
		"refreshing":    true,
	})
}
