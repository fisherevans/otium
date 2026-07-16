package store

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

// Durable metadata-enrichment queue (#120). A generic mechanism: each row is one
// (item, enricher kind) unit of out-of-band work. The enrich worker owns the
// policy (retries, backoff, rate-limit cooldown); this file is just the durable
// state + the item accessors an enricher needs.

const (
	EnrichPending = "pending"
	EnrichDone    = "done"
	EnrichFailed  = "failed"
)

// EnrichCandidate is the minimal item shape an enricher inspects to decide whether
// it wants to enrich the item, and to do the fetch (URL). Deliberately not the full
// Item - the worker sweeps many of these.
type EnrichCandidate struct {
	ID          int64
	SourceKind  string
	MediaType   string
	DurationSec int
	AspectRatio float64
	URL         string
}

// EnrichTask is one due unit of work returned to the worker.
type EnrichTask struct {
	ItemID   int64
	Kind     string
	Attempts int
}

const enrichCandidateCols = `i.id, s.kind, i.media_type, i.duration_sec, i.aspect_ratio, i.url`

func scanCandidate(row interface{ Scan(...any) error }) (EnrichCandidate, error) {
	var c EnrichCandidate
	err := row.Scan(&c.ID, &c.SourceKind, &c.MediaType, &c.DurationSec, &c.AspectRatio, &c.URL)
	return c, err
}

// ItemsAfter returns enrichment candidates with id > afterID, ascending. Powers the
// durable backfill/new-item sweep: the worker walks the whole item history once (a
// cursor in meta), and because new items get higher ids the same sweep keeps
// picking them up - no separate new-item path needed.
func (db *DB) ItemsAfter(ctx context.Context, afterID int64, limit int) ([]EnrichCandidate, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT `+enrichCandidateCols+`
		 FROM items i JOIN sources s ON s.id = i.source_id
		 WHERE i.id > ? ORDER BY i.id ASC LIMIT ?`, afterID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EnrichCandidate
	for rows.Next() {
		c, err := scanCandidate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// EnrichCandidateByID loads one candidate (the worker re-reads at process time so
// it acts on current duration/media_type, not a stale sweep snapshot).
func (db *DB) EnrichCandidateByID(ctx context.Context, itemID int64) (EnrichCandidate, bool, error) {
	c, err := scanCandidate(db.sql.QueryRowContext(ctx,
		`SELECT `+enrichCandidateCols+`
		 FROM items i JOIN sources s ON s.id = i.source_id WHERE i.id = ?`, itemID))
	if err == sql.ErrNoRows {
		return EnrichCandidate{}, false, nil
	}
	return c, err == nil, err
}

// EnqueueEnrichment adds a pending task if one doesn't already exist (idempotent).
func (db *DB) EnqueueEnrichment(ctx context.Context, itemID int64, kind string) error {
	_, err := db.sql.ExecContext(ctx,
		`INSERT OR IGNORE INTO item_enrichment (item_id, kind) VALUES (?, ?)`, itemID, kind)
	return err
}

// sqlTime formats a time to match SQLite's datetime('now') (UTC, no T/Z), so
// next_attempt_at values written from Go compare lexically against the column's
// datetime('now') default and against the `now` passed to DueEnrichments.
func sqlTime(t time.Time) string { return t.UTC().Format("2006-01-02 15:04:05") }

// DueEnrichments returns pending tasks whose backoff has elapsed as of `now`,
// soonest first. Taking now as a param (rather than SQL datetime('now')) lets the
// worker own the clock, which keeps scheduling consistent and testable.
func (db *DB) DueEnrichments(ctx context.Context, now time.Time, limit int) ([]EnrichTask, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT item_id, kind, attempts FROM item_enrichment
		 WHERE status = 'pending' AND next_attempt_at <= ?
		 ORDER BY next_attempt_at ASC LIMIT ?`, sqlTime(now), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EnrichTask
	for rows.Next() {
		var t EnrichTask
		if err := rows.Scan(&t.ItemID, &t.Kind, &t.Attempts); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// CountPendingEnrichments reports how much work is queued (for logging/metrics).
func (db *DB) CountPendingEnrichments(ctx context.Context) (int, error) {
	var n int
	err := db.sql.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM item_enrichment WHERE status = 'pending'`).Scan(&n)
	return n, err
}

// CompleteEnrichment marks a task done.
func (db *DB) CompleteEnrichment(ctx context.Context, itemID int64, kind string) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE item_enrichment SET status='done', attempts=attempts+1, last_error='', updated_at=datetime('now')
		 WHERE item_id=? AND kind=?`, itemID, kind)
	return err
}

// RetryEnrichment reschedules a transient failure with the given next-attempt time.
func (db *DB) RetryEnrichment(ctx context.Context, itemID int64, kind string, next time.Time, errMsg string) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE item_enrichment SET attempts=attempts+1, next_attempt_at=?, last_error=?, updated_at=datetime('now')
		 WHERE item_id=? AND kind=?`, sqlTime(next), errMsg, itemID, kind)
	return err
}

// FailEnrichment marks a task permanently failed ("data not available").
func (db *DB) FailEnrichment(ctx context.Context, itemID int64, kind string, errMsg string) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE item_enrichment SET status='failed', attempts=attempts+1, last_error=?, updated_at=datetime('now')
		 WHERE item_id=? AND kind=?`, errMsg, itemID, kind)
	return err
}

// AspectBackfillItem is a YouTube video item still missing its frame aspect ratio.
// VideoID comes straight from external_id (yt:video:<id>), so no URL parsing.
type AspectBackfillItem struct {
	ID      int64
	VideoID string
}

// ItemsMissingAspect returns up to `limit` YouTube short/long items with no
// aspect_ratio yet, oldest id first. Powers the one-time backfill: the enrichment
// sweep is forward-only from a cursor, so it won't revisit already-enriched items -
// this batches them through the API (50/call) instead.
func (db *DB) ItemsMissingAspect(ctx context.Context, limit int) ([]AspectBackfillItem, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT i.id, i.external_id
		 FROM items i JOIN sources s ON s.id = i.source_id
		 WHERE s.kind = 'youtube' AND i.media_type IN ('short','long') AND i.aspect_ratio = 0
		 ORDER BY i.id LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AspectBackfillItem
	for rows.Next() {
		var id int64
		var ext string
		if err := rows.Scan(&id, &ext); err != nil {
			return nil, err
		}
		vid := strings.TrimPrefix(ext, "yt:video:")
		if vid == ext || vid == "" {
			continue // not a yt:video: external id
		}
		out = append(out, AspectBackfillItem{ID: id, VideoID: vid})
	}
	return out, rows.Err()
}

// SetItemAspect writes a video item's frame aspect ratio (backfill path).
func (db *DB) SetItemAspect(ctx context.Context, id int64, aspect float64) error {
	_, err := db.sql.ExecContext(ctx, `UPDATE items SET aspect_ratio=? WHERE id=?`, aspect, id)
	return err
}

// SetItemDuration is how an enricher applies fetched video length: sets duration and
// (unless the item was a livestream) re-buckets short/long from the real duration.
// aspect is the frame aspect ratio (w/h); it's only written when > 0 so a fallback
// path with no aspect data (the watch-page scraper) never clobbers a known value.
func (db *DB) SetItemDuration(ctx context.Context, itemID int64, durationSec int, mediaType string, aspect float64) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE items SET duration_sec=?, media_type=?,
		        aspect_ratio = CASE WHEN ? > 0 THEN ? ELSE aspect_ratio END
		 WHERE id=?`, durationSec, mediaType, aspect, aspect, itemID)
	return err
}

// MetaGet / MetaSet back the global (non-user) system cursors, e.g. the enrichment
// sweep position.
func (db *DB) MetaGet(ctx context.Context, key string) (string, error) {
	var v string
	err := db.sql.QueryRowContext(ctx, `SELECT value FROM meta WHERE key=?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}

func (db *DB) MetaSet(ctx context.Context, key, value string) error {
	_, err := db.sql.ExecContext(ctx,
		`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}
