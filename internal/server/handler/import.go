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
// OPML folders into topics. It returns immediately and refreshes the new topics in
// the background (fetching hundreds of topics inline would block the request).
func (h *Handler) CommitImport(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	var body struct {
		Sources             []importer.Candidate `json:"sources"`
		CreateTopicsFolders bool                 `json:"create_topics_from_folders"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.Sources) == 0 {
		badRequest(w, "no sources to import")
		return
	}

	created, skipped := 0, 0
	topicIDs := map[string]int64{}
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
		if body.CreateTopicsFolders && c.Category != "" {
			fid, ok := topicIDs[c.Category]
			if !ok {
				f, err := h.db.GetOrCreateTopic(r.Context(), uid, c.Category, slugify(c.Category), "")
				if err != nil {
					h.log.Warn("import: topic create failed", "cat", c.Category, "err", err)
					continue
				}
				fid = f.ID
				topicIDs[c.Category] = fid
			}
			if err := h.db.AssignSourceTopic(r.Context(), id, fid); err != nil {
				h.log.Warn("import: source->topic assign failed", "source", id, "topic", fid, "err", err)
			}
			continue
		}
		// Auto-tag untagged YouTube sources into the Videos topic (#53) so future
		// YouTube-Takeout imports land there instead of an untagged mass. Only when
		// the candidate carries no folder/category of its own.
		if c.Kind == "youtube" && c.Category == "" {
			f, err := h.db.GetOrCreateVideosTopic(r.Context(), uid)
			if err != nil {
				h.log.Warn("import: videos topic create failed", "err", err)
				continue
			}
			if err := h.db.AssignSourceTopic(r.Context(), id, f.ID); err != nil {
				h.log.Warn("import: youtube source->videos assign failed", "source", id, "err", err)
			}
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
		"created":        created,
		"already_had":    skipped,
		"topics_created": len(topicIDs),
		"refreshing":     true,
	})
}
