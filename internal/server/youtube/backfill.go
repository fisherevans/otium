package youtube

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// BackfillAspects fills aspect_ratio for existing YouTube video items that predate
// the metadata (the enrichment sweep is forward-only, so it never revisits them).
// It batches 50 ids per videos.list call (part=player), so the whole backlog costs
// ~1 quota unit per 50 items. Self-terminating and idempotent: it drains items with
// aspect_ratio=0 and exits, so it's safe to run on every startup - once the backlog
// is filled the first query returns nothing.
//
// An item whose video is private/removed (no player dimensions) is written a 16:9
// default so it leaves the missing set and the loop always converges.
// BackfillAvatars fills icon_url for YouTube sources that have no avatar yet (#155):
// sources added or imported before add-time avatar capture (handler.ResolveChannel)
// existed stayed on the monogram fallback. It resolves the channel avatar via
// channels.list, batched 50 ids per call (~1 quota unit per 50 sources), and writes
// each with SetSourceIcon (which no-ops if an icon appeared meanwhile).
//
// One pass over a snapshot of the missing set, chunked in memory - not a drain loop -
// so a channel the API can't resolve (deleted/renamed, no thumbnail) simply stays
// blank rather than looping forever; it's retried cheaply on the next startup. Safe
// to run every boot: once every source has an icon the first query returns nothing.
func BackfillAvatars(ctx context.Context, db *store.DB, c *Client, log *slog.Logger) {
	srcs, err := db.YouTubeSourcesMissingIcon(ctx)
	if err != nil {
		log.Warn("avatar backfill: query failed", "err", err)
		return
	}
	if len(srcs) == 0 {
		return
	}
	// Map each resolvable channel id back to its source id. Sources whose feed_url
	// isn't a channel feed (no UC id) can't be resolved this way - skip them.
	byChannel := make(map[string]int64, len(srcs))
	ids := make([]string, 0, len(srcs))
	for _, s := range srcs {
		cid := ChannelIDFromFeedURL(s.FeedURL)
		if cid == "" {
			continue
		}
		byChannel[cid] = s.ID
		ids = append(ids, cid)
	}

	const batch = 50
	filled := 0
	for start := 0; start < len(ids); start += batch {
		end := start + batch
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[start:end]
		avatars, err := c.ChannelAvatars(ctx, chunk)
		if err != nil {
			var te *TransientError
			if errors.As(err, &te) {
				// quota / 5xx / network - wait and retry the same chunk.
				select {
				case <-ctx.Done():
					return
				case <-time.After(60 * time.Second):
					start -= batch // undo the loop's advance so we redo this chunk
					continue
				}
			}
			log.Warn("avatar backfill: fetch failed", "err", err)
			return
		}
		for cid, url := range avatars {
			if err := db.SetSourceIcon(ctx, byChannel[cid], url); err != nil {
				log.Warn("avatar backfill: write failed", "source", byChannel[cid], "err", err)
				continue
			}
			filled++
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(400 * time.Millisecond):
		}
	}
	if filled > 0 {
		log.Info("avatar backfill complete", "sources", filled, "missing", len(srcs))
	}
}

func BackfillAspects(ctx context.Context, db *store.DB, c *Client, log *slog.Logger) {
	const batch = 50
	total := 0
	for {
		items, err := db.ItemsMissingAspect(ctx, batch)
		if err != nil {
			log.Warn("aspect backfill: query failed", "err", err)
			return
		}
		if len(items) == 0 {
			break
		}
		vids := make([]Video, len(items))
		for i, it := range items {
			vids[i] = Video{ID: it.VideoID}
		}
		if err := c.FillDetails(ctx, vids); err != nil {
			var te *TransientError
			if errors.As(err, &te) {
				// quota / 5xx / network - wait and retry the same batch.
				select {
				case <-ctx.Done():
					return
				case <-time.After(60 * time.Second):
					continue
				}
			}
			log.Warn("aspect backfill: fetch failed", "err", err)
			return
		}
		for i, it := range items {
			a := vids[i].AspectRatio
			if a == 0 {
				a = 16.0 / 9.0 // couldn't read dims (private/removed) - default + mark done
			}
			if err := db.SetItemAspect(ctx, it.ID, a); err != nil {
				log.Warn("aspect backfill: write failed", "item", it.ID, "err", err)
			}
		}
		total += len(items)
		select {
		case <-ctx.Done():
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
	if total > 0 {
		log.Info("aspect backfill complete", "items", total)
	}
}
