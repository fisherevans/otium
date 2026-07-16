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
