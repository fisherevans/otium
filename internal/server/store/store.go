// Package store is otium's SQLite persistence layer. It owns the schema
// (embedded, applied idempotently on Open) and all queries. otium is
// single-replica, so a plain *sql.DB against a WAL-mode SQLite file is enough;
// there is no connection-pool contention to design around.
package store

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

type DB struct {
	sql *sql.DB
}

// Open opens (creating if needed) the SQLite database at path and applies the
// schema. path may be a file path or ":memory:" for tests.
func Open(path string) (*DB, error) {
	dsn := path + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)"
	sdb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	sdb.SetMaxOpenConns(1) // single writer; avoids SQLITE_BUSY under WAL for a homelab load
	if _, err := sdb.ExecContext(context.Background(), schemaSQL); err != nil {
		sdb.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	if err := migrate(sdb); err != nil {
		sdb.Close()
		return nil, fmt.Errorf("migrate schema: %w", err)
	}
	return &DB{sql: sdb}, nil
}

// migrate applies additive, idempotent schema changes for databases that
// predate a column. schema.sql's CREATE TABLE statements are IF NOT EXISTS, so
// they never touch an existing table - column adds have to run separately.
// SQLite has no ADD COLUMN IF NOT EXISTS, so each add is guarded on
// pragma_table_info. Every migration here must be safe to run on every boot.
func migrate(sdb *sql.DB) error {
	if err := ensureColumn(sdb, "feeds", "icon", `ALTER TABLE feeds ADD COLUMN icon TEXT NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	if err := ensureColumn(sdb, "feeds", "half_life_days", `ALTER TABLE feeds ADD COLUMN half_life_days REAL NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	if err := ensureColumn(sdb, "feeds", "diversity", `ALTER TABLE feeds ADD COLUMN diversity INTEGER NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	// items.content (#58): full article body as raw HTML, rendered in the reader.
	return ensureColumn(sdb, "items", "content", `ALTER TABLE items ADD COLUMN content TEXT NOT NULL DEFAULT ''`)
}

// ensureColumn adds a column via ddl only if it isn't already present. This is
// the idempotent guard that lets an ALTER run on every boot without erroring on
// an already-migrated database.
func ensureColumn(sdb *sql.DB, table, column, ddl string) error {
	// Skip if the table doesn't exist yet. In production schema.sql's CREATE TABLE
	// runs first so this never trips, but it keeps migrate() safe to call against a
	// partial DB (e.g. a test that only sets up one table).
	var tableExists int
	if err := sdb.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?`, table).Scan(&tableExists); err != nil {
		return err
	}
	if tableExists == 0 {
		return nil
	}
	var exists int
	err := sdb.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, table, column).Scan(&exists)
	if err != nil {
		return err
	}
	if exists > 0 {
		return nil
	}
	_, err = sdb.ExecContext(context.Background(), ddl)
	return err
}

func (db *DB) Close() error { return db.sql.Close() }

// --- users ---

func (db *DB) UpsertUserByUsername(ctx context.Context, username, email string) (*User, error) {
	_, err := db.sql.ExecContext(ctx,
		`INSERT INTO users (username, email) VALUES (?, ?)
		 ON CONFLICT(username) DO UPDATE SET email=excluded.email WHERE excluded.email <> ''`,
		username, email)
	if err != nil {
		return nil, err
	}
	var u User
	var created string
	err = db.sql.QueryRowContext(ctx,
		`SELECT id, username, email, name, created_at FROM users WHERE username = ?`, username).
		Scan(&u.ID, &u.Username, &u.Email, &u.Name, &created)
	if err != nil {
		return nil, err
	}
	u.CreatedAt = parseTime(created)
	return &u, nil
}

// --- feeds ---

func (db *DB) ListFeeds(ctx context.Context, userID int64) ([]Feed, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT f.id, f.name, f.slug, f.color, f.icon, f.half_life_days, f.diversity, f.sort, f.created_at,
		        (SELECT COUNT(*) FROM feed_sources fs WHERE fs.feed_id = f.id) AS source_count
		 FROM feeds f WHERE f.user_id = ? ORDER BY f.sort, f.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Feed
	for rows.Next() {
		var f Feed
		var created string
		if err := rows.Scan(&f.ID, &f.Name, &f.Slug, &f.Color, &f.Icon, &f.HalfLifeDays, &f.Diversity, &f.Sort, &created, &f.SourceCount); err != nil {
			return nil, err
		}
		f.CreatedAt = parseTime(created)
		out = append(out, f)
	}
	return out, rows.Err()
}

func (db *DB) CreateFeed(ctx context.Context, userID int64, name, slug, color string) (*Feed, error) {
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO feeds (user_id, name, slug, color) VALUES (?, ?, ?, ?)`,
		userID, name, slug, color)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Feed{ID: id, UserID: userID, Name: name, Slug: slug, Color: color}, nil
}

// GetOrCreateFeed returns the feed with this slug, creating it if absent. Used
// by import to turn OPML folders into feeds without duplicating.
func (db *DB) GetOrCreateFeed(ctx context.Context, userID int64, name, slug, color string) (*Feed, error) {
	var f Feed
	err := db.sql.QueryRowContext(ctx,
		`SELECT id, name, slug, color FROM feeds WHERE user_id = ? AND slug = ?`, userID, slug).
		Scan(&f.ID, &f.Name, &f.Slug, &f.Color)
	if err == nil {
		return &f, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	return db.CreateFeed(ctx, userID, name, slug, color)
}

// Videos feed (#53): the auto-grouping bucket for untagged YouTube sources.
const (
	videosFeedName = "Videos"
	videosFeedSlug = "videos"
	videosFeedIcon = "film" // Clapperboard glyph; see web/src/lib/feedIcons.ts
	// videosBackfillKey gates the one-time untagged-YouTube grouping so it runs
	// exactly once and never re-groups sources Fisher later pulls out by hand.
	videosBackfillKey = "videos_backfill_done"
)

// GetOrCreateVideosFeed returns the user's Videos feed, creating it (with the
// film icon) if absent. Idempotent via the (user_id, slug) unique constraint;
// if the feed already exists its name/icon are left untouched so a later manual
// rename or re-icon survives.
func (db *DB) GetOrCreateVideosFeed(ctx context.Context, userID int64) (*Feed, error) {
	if _, err := db.sql.ExecContext(ctx,
		`INSERT INTO feeds (user_id, name, slug, icon) VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, slug) DO NOTHING`,
		userID, videosFeedName, videosFeedSlug, videosFeedIcon); err != nil {
		return nil, err
	}
	var f Feed
	err := db.sql.QueryRowContext(ctx,
		`SELECT id, name, slug, color, icon FROM feeds WHERE user_id = ? AND slug = ?`,
		userID, videosFeedSlug).Scan(&f.ID, &f.Name, &f.Slug, &f.Color, &f.Icon)
	if err != nil {
		return nil, err
	}
	f.UserID = userID
	return &f, nil
}

// BackfillVideosFeed is a one-time, marker-guarded migration (#53): it ensures
// the Videos feed exists and assigns every youtube-kind source that currently
// belongs to NO feed to it. Guarded by the kv 'videos_backfill_done' flag so it
// runs exactly once per user and never re-groups sources later pulled out.
// Returns the number of sources assigned (0 on every run after the first).
func (db *DB) BackfillVideosFeed(ctx context.Context, userID int64) (int, error) {
	if _, done, err := db.kvGet(ctx, userID, videosBackfillKey); err != nil {
		return 0, err
	} else if done {
		return 0, nil
	}
	f, err := db.GetOrCreateVideosFeed(ctx, userID)
	if err != nil {
		return 0, err
	}
	res, err := db.sql.ExecContext(ctx,
		`INSERT OR IGNORE INTO feed_sources (feed_id, source_id)
		 SELECT ?, s.id FROM sources s
		 WHERE s.user_id = ? AND s.kind = 'youtube'
		   AND NOT EXISTS (SELECT 1 FROM feed_sources fs WHERE fs.source_id = s.id)`,
		f.ID, userID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if err := db.kvSet(ctx, userID, videosBackfillKey, "1"); err != nil {
		return 0, err
	}
	return int(n), nil
}

// --- kv (one-time migration markers / settings flags) ---

func (db *DB) kvGet(ctx context.Context, userID int64, key string) (string, bool, error) {
	var v string
	err := db.sql.QueryRowContext(ctx,
		`SELECT value FROM kv WHERE user_id = ? AND key = ?`, userID, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

func (db *DB) kvSet(ctx context.Context, userID int64, key, value string) error {
	_, err := db.sql.ExecContext(ctx,
		`INSERT INTO kv (user_id, key, value) VALUES (?, ?, ?)
		 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
		userID, key, value)
	return err
}

// UpdateFeed patches a feed's presentation fields (name, color, icon) and the
// per-feed ranker overrides (half-life, diversity). Only non-nil fields are
// applied. Scoped to the owning user.
func (db *DB) UpdateFeed(ctx context.Context, userID, id int64, name, color, icon *string, halfLifeDays *float64, diversity *int) error {
	var sets []string
	var args []any
	if name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *name)
	}
	if color != nil {
		sets = append(sets, "color = ?")
		args = append(args, *color)
	}
	if icon != nil {
		sets = append(sets, "icon = ?")
		args = append(args, *icon)
	}
	if halfLifeDays != nil {
		sets = append(sets, "half_life_days = ?")
		args = append(args, *halfLifeDays)
	}
	if diversity != nil {
		sets = append(sets, "diversity = ?")
		args = append(args, *diversity)
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id, userID)
	_, err := db.sql.ExecContext(ctx,
		`UPDATE feeds SET `+strings.Join(sets, ", ")+` WHERE id = ? AND user_id = ?`, args...)
	return err
}

// PrimaryFeedsForSources resolves the single "primary" feed for each of the
// given sources, for the session card's identity line. A source in exactly one
// feed maps to that feed; a source in several maps to the deterministic winner
// (lowest feed sort, then lowest id). A source in no feed is absent from the map
// (the card then renders source-only). Rows come back ordered so the first row
// per source_id is its primary.
func (db *DB) PrimaryFeedsForSources(ctx context.Context, userID int64, sourceIDs []int64) (map[int64]FeedRef, error) {
	out := map[int64]FeedRef{}
	if len(sourceIDs) == 0 {
		return out, nil
	}
	q := `SELECT fs.source_id, f.name, f.slug, f.color, f.icon
	      FROM feed_sources fs JOIN feeds f ON f.id = fs.feed_id
	      WHERE f.user_id = ? AND fs.source_id IN (` + placeholders(len(sourceIDs)) + `)
	      ORDER BY fs.source_id, f.sort, f.id`
	args := []any{userID}
	for _, id := range sourceIDs {
		args = append(args, id)
	}
	rows, err := db.sql.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var sid int64
		var f FeedRef
		if err := rows.Scan(&sid, &f.Name, &f.Slug, &f.Color, &f.Icon); err != nil {
			return nil, err
		}
		if _, seen := out[sid]; !seen { // first row per source is the primary (ordered)
			out[sid] = f
		}
	}
	return out, rows.Err()
}

// SetSourceFeeds replaces the set of feeds a source belongs to (source-centric
// assignment, for the library UI). Feeds are given by slug; unknown slugs are
// ignored.
func (db *DB) SetSourceFeeds(ctx context.Context, userID, sourceID int64, slugs []string) error {
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// verify the source belongs to the user before touching memberships
	var owner int64
	if err := tx.QueryRowContext(ctx, `SELECT user_id FROM sources WHERE id = ?`, sourceID).Scan(&owner); err != nil {
		return err
	}
	if owner != userID {
		return fmt.Errorf("source %d not owned by user", sourceID)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM feed_sources WHERE source_id = ?`, sourceID); err != nil {
		return err
	}
	for _, slug := range slugs {
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO feed_sources (feed_id, source_id)
			 SELECT id, ? FROM feeds WHERE user_id = ? AND slug = ?`,
			sourceID, userID, slug); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// AddFeedSource adds a source to a feed without disturbing existing members.
func (db *DB) AddFeedSource(ctx context.Context, feedID, sourceID int64) error {
	_, err := db.sql.ExecContext(ctx,
		`INSERT OR IGNORE INTO feed_sources (feed_id, source_id) VALUES (?, ?)`, feedID, sourceID)
	return err
}

// CreateSourceImport inserts a source, or returns the existing one's id if the
// (user, feed_url) already exists. created reports whether a new row was made,
// so import can report "N added, M already followed".
func (db *DB) CreateSourceImport(ctx context.Context, s *Source) (id int64, created bool, err error) {
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO sources (user_id, kind, title, feed_url, homepage_url, weight, state)
		 VALUES (?, ?, ?, ?, ?, ?, 'followed')
		 ON CONFLICT(user_id, feed_url) DO NOTHING`,
		s.UserID, def(s.Kind, "rss"), s.Title, s.FeedURL, s.HomepageURL, defF(s.Weight, 1.0))
	if err != nil {
		return 0, false, err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		id, _ = res.LastInsertId()
		return id, true, nil
	}
	// Already existed - fetch its id so it can still be added to a feed.
	err = db.sql.QueryRowContext(ctx,
		`SELECT id FROM sources WHERE user_id = ? AND feed_url = ?`, s.UserID, s.FeedURL).Scan(&id)
	return id, false, err
}

// SetFeedSources replaces the source membership of a feed.
func (db *DB) SetFeedSources(ctx context.Context, userID, feedID int64, sourceIDs []int64) error {
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM feed_sources WHERE feed_id = ?`, feedID); err != nil {
		return err
	}
	for _, sid := range sourceIDs {
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO feed_sources (feed_id, source_id) VALUES (?, ?)`, feedID, sid); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// --- sources ---

func (db *DB) ListSources(ctx context.Context, userID int64) ([]Source, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT s.id, s.kind, s.title, s.feed_url, s.homepage_url, s.icon_url, s.weight,
		        s.state, s.trial_until, s.per_session_cap, s.added_at, s.last_fetch_at, s.fetch_error,
		        (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id) AS item_count,
		        (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id
		           AND NOT EXISTS (SELECT 1 FROM item_state st WHERE st.item_id = i.id AND st.user_id = ?)) AS unseen_count,
		        (SELECT COALESCE(CAST(SUM(CASE WHEN st.state='skipped' THEN 1 ELSE 0 END) AS REAL)
		           / NULLIF(COUNT(*), 0), 0)
		         FROM item_state st JOIN items i2 ON i2.id = st.item_id
		         WHERE i2.source_id = s.id AND st.user_id = ?) AS skip_pct,
		        (SELECT COUNT(*) / 30.0 FROM items i3
		         WHERE i3.source_id = s.id AND i3.published_at >= datetime('now', '-30 days')) AS posts_per_day
		 FROM sources s WHERE s.user_id = ? ORDER BY s.title`, userID, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Source
	byID := map[int64]*Source{}
	for rows.Next() {
		s, err := scanSource(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		byID[out[i].ID] = &out[i]
	}
	// attach feed slugs
	frows, err := db.sql.QueryContext(ctx,
		`SELECT fs.source_id, f.slug FROM feed_sources fs
		 JOIN feeds f ON f.id = fs.feed_id WHERE f.user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer frows.Close()
	for frows.Next() {
		var sid int64
		var slug string
		if err := frows.Scan(&sid, &slug); err != nil {
			return nil, err
		}
		if s := byID[sid]; s != nil {
			s.FeedSlugs = append(s.FeedSlugs, slug)
		}
	}
	return out, frows.Err()
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSource(r rowScanner) (*Source, error) {
	var s Source
	var added string
	var trialUntil, lastFetch sql.NullString
	if err := r.Scan(&s.ID, &s.Kind, &s.Title, &s.FeedURL, &s.HomepageURL, &s.IconURL, &s.Weight,
		&s.State, &trialUntil, &s.PerSessionCap, &added, &lastFetch, &s.FetchError,
		&s.ItemCount, &s.UnseenCount, &s.SkipPct, &s.PostsPerDay); err != nil {
		return nil, err
	}
	s.AddedAt = parseTime(added)
	if trialUntil.Valid {
		t := parseTime(trialUntil.String)
		s.TrialUntil = &t
	}
	if lastFetch.Valid {
		t := parseTime(lastFetch.String)
		s.LastFetchAt = &t
	}
	return &s, nil
}

func (db *DB) CreateSource(ctx context.Context, s *Source) (*Source, error) {
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO sources (user_id, kind, title, feed_url, homepage_url, icon_url, weight, state, per_session_cap)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.UserID, def(s.Kind, "rss"), s.Title, s.FeedURL, s.HomepageURL, s.IconURL,
		defF(s.Weight, 1.0), def(s.State, "followed"), defI(s.PerSessionCap, 2))
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	s.ID = id
	return s, nil
}

// UpdateSource patches weight, state, per_session_cap, title. Only non-nil
// fields are applied.
func (db *DB) UpdateSource(ctx context.Context, userID, id int64, weight *float64, state *string, cap *int, title *string) error {
	var sets []string
	var args []any
	if weight != nil {
		sets = append(sets, "weight = ?")
		args = append(args, *weight)
	}
	if state != nil {
		sets = append(sets, "state = ?")
		args = append(args, *state)
	}
	if cap != nil {
		sets = append(sets, "per_session_cap = ?")
		args = append(args, *cap)
	}
	if title != nil {
		sets = append(sets, "title = ?")
		args = append(args, *title)
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id, userID)
	_, err := db.sql.ExecContext(ctx,
		`UPDATE sources SET `+strings.Join(sets, ", ")+` WHERE id = ? AND user_id = ?`, args...)
	return err
}

func (db *DB) DeleteSource(ctx context.Context, userID, id int64) error {
	_, err := db.sql.ExecContext(ctx, `DELETE FROM sources WHERE id = ? AND user_id = ?`, id, userID)
	return err
}

// SourcesToFetch returns non-archived sources for a user, for the ingest loop.
func (db *DB) SourcesToFetch(ctx context.Context, userID int64) ([]Source, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT id, kind, title, feed_url, homepage_url, icon_url, weight, state, per_session_cap
		 FROM sources WHERE user_id = ? AND state != 'archived'`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Source
	for rows.Next() {
		var s Source
		s.UserID = userID
		if err := rows.Scan(&s.ID, &s.Kind, &s.Title, &s.FeedURL, &s.HomepageURL, &s.IconURL,
			&s.Weight, &s.State, &s.PerSessionCap); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// --- items ---

// UpsertItem inserts an item if its (source_id, external_id) is new. Returns
// true if a new row was created.
func (db *DB) UpsertItem(ctx context.Context, it *Item) (bool, error) {
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO items (source_id, external_id, url, title, summary, content, author, thumbnail_url, media_type, duration_sec, published_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(source_id, external_id) DO NOTHING`,
		it.SourceID, it.ExternalID, it.URL, it.Title, it.Summary, it.Content, it.Author, it.ThumbnailURL,
		def(it.MediaType, "unknown"), it.DurationSec, it.PublishedAt.UTC().Format(time.RFC3339))
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func (db *DB) MarkFetched(ctx context.Context, sourceID int64, fetchErr string) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE sources SET last_fetch_at = datetime('now'), fetch_error = ? WHERE id = ?`,
		fetchErr, sourceID)
	return err
}

// ListRecentItemsBySource returns the newest items for a single source, for the
// "catch up on this creator" drill-in view.
func (db *DB) ListRecentItemsBySource(ctx context.Context, userID, sourceID int64, limit int) ([]Item, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT id, source_id, url, title, summary, content, author, thumbnail_url, media_type, duration_sec, published_at, fetched_at
		 FROM items WHERE source_id = ? ORDER BY published_at DESC LIMIT ?`, sourceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanItems(rows)
}

// candidateCols is the shared projection for Candidates and MixItems: item +
// source facts, the accumulated-history cadence inputs (win_count/win_span), and
// the resolved primary-feed overrides (half-life + diversity). The primary feed
// is the source's lowest-sort (then lowest-id) feed, matching
// PrimaryFeedsForSources; a feedless source COALESCEs to 0 (global defaults).
// Both queries must select these in this order so scanCandidates can read either
// result set. The ? placeholders are the cadence-window bound, twice.
const candidateCols = `i.id, i.source_id, i.url, i.title, i.summary, i.content, i.author, i.thumbnail_url,
	             i.media_type, i.duration_sec, i.published_at, i.fetched_at,
	             s.title, s.weight, s.per_session_cap,
	             (SELECT COUNT(*) FROM items i2 WHERE i2.source_id = s.id
	                AND i2.published_at >= datetime('now', ?)) AS win_count,
	             (SELECT COALESCE(julianday('now') - julianday(MIN(i2.published_at)), 0)
	                FROM items i2 WHERE i2.source_id = s.id
	                AND i2.published_at >= datetime('now', ?)) AS win_span,
	             COALESCE((SELECT f.half_life_days FROM feed_sources fs JOIN feeds f ON f.id = fs.feed_id
	                WHERE fs.source_id = s.id ORDER BY f.sort, f.id LIMIT 1), 0) AS feed_half_life,
	             COALESCE((SELECT f.diversity FROM feed_sources fs JOIN feeds f ON f.id = fs.feed_id
	                WHERE fs.source_id = s.id ORDER BY f.sort, f.id LIMIT 1), 0) AS feed_diversity`

// cadence-estimation floors. See cadencePerDay.
const (
	// minCadenceItems is the number of stored publishes below which we won't
	// estimate a source's cadence: with fewer than this in the window there isn't
	// enough signal to call a source "rare", so it gets no boost.
	minCadenceItems = 3
	// cadenceRareFloor is the per-day rate returned for thin history. It sits at
	// the ranker's rare threshold (session.rareThresholdPerDay = 1.0/day): a
	// cadence >= that threshold makes rarityBoost() return 1, i.e. no boost. Kept
	// in lockstep with that constant intentionally.
	cadenceRareFloor = 1.0
	// minObservationDays floors the divisor so a dense burst in a short window (a
	// just-added high-volume source) reads as high-cadence, not rare, and we never
	// divide by ~0.
	minObservationDays = 1.0
)

// cadencePerDay estimates a source's posting rate from its ACCUMULATED stored
// items: count within the window over the observed span (now - earliest item in
// the window), not the fixed window. otium stores every item it ever fetches, so
// this history accrues past a feed's ~10-15 entry truncation. Dividing by the
// observed span rather than the full window keeps a high-volume source whose feed
// only exposes a recent slice from reading as rare once even a little history has
// accumulated (the NPR-labeled-rare bug). Thin history (< minCadenceItems)
// returns cadenceRareFloor: too little signal to justify a rarity boost.
func cadencePerDay(count int, spanDays float64, windowDays int) float64 {
	if count < minCadenceItems {
		return cadenceRareFloor
	}
	span := spanDays
	if w := float64(windowDays); span > w {
		span = w
	}
	if span < minObservationDays {
		span = minObservationDays
	}
	return float64(count) / span
}

// scanCandidates reads the candidateCols projection into Candidates, computing
// each source's cadence from its accumulated stored history (windowDays sets the
// rarity window) and carrying the resolved primary-feed overrides.
func scanCandidates(rows *sql.Rows, windowDays int) ([]Candidate, error) {
	var out []Candidate
	for rows.Next() {
		var c Candidate
		var pub, fetched string
		var winCount int
		var winSpan, halfLife float64
		var diversity int
		if err := rows.Scan(&c.ID, &c.SourceID, &c.URL, &c.Title, &c.Summary, &c.Content, &c.Author, &c.ThumbnailURL,
			&c.MediaType, &c.DurationSec, &pub, &fetched,
			&c.SourceTitle, &c.SourceWeight, &c.PerSessionCap,
			&winCount, &winSpan, &halfLife, &diversity); err != nil {
			return nil, err
		}
		c.PublishedAt = parseTime(pub)
		c.FetchedAt = parseTime(fetched)
		c.SourceCadence = cadencePerDay(winCount, winSpan, windowDays)
		c.FeedHalfLifeDays = halfLife
		c.FeedDiversity = diversity
		out = append(out, c)
	}
	return out, rows.Err()
}

// Candidates returns unseen items from the given sources (or all followed
// sources if sourceIDs is empty), newest first, as ranker input. It computes
// each source's cadence from accumulated stored history in the same pass.
func (db *DB) Candidates(ctx context.Context, userID int64, sourceIDs []int64, sinceDays, limit int) ([]Candidate, error) {
	q := `SELECT ` + candidateCols + `
	      FROM items i
	      JOIN sources s ON s.id = i.source_id
	      WHERE s.user_id = ? AND s.state IN ('followed','trial')
	        AND NOT EXISTS (SELECT 1 FROM item_state st WHERE st.item_id = i.id AND st.user_id = ?)`
	win := fmt.Sprintf("-%d days", sinceDays)
	args := []any{win, win, userID, userID}
	if len(sourceIDs) > 0 {
		q += ` AND s.id IN (` + placeholders(len(sourceIDs)) + `)`
		for _, id := range sourceIDs {
			args = append(args, id)
		}
	}
	q += ` ORDER BY i.published_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := db.sql.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCandidates(rows, sinceDays)
}

// MixItems returns every item belonging to the user's followed/trial sources
// (optionally restricted to sourceIDs), each carrying the source facts the
// scorer needs (title, weight, recent cadence). Unlike Candidates it does NOT
// filter to unseen items and applies no row limit: the mix view sums the current
// freshness-decayed score of ALL known items, so stale items fall out through
// decay, not a WHERE clause. cadenceDays sets the rarity-boost cadence window, to
// match the session builder's rarity semantics. Rows are ordered deterministically.
func (db *DB) MixItems(ctx context.Context, userID int64, sourceIDs []int64, cadenceDays int) ([]Candidate, error) {
	q := `SELECT ` + candidateCols + `
	      FROM items i
	      JOIN sources s ON s.id = i.source_id
	      WHERE s.user_id = ? AND s.state IN ('followed','trial')`
	win := fmt.Sprintf("-%d days", cadenceDays)
	args := []any{win, win, userID}
	if len(sourceIDs) > 0 {
		q += ` AND s.id IN (` + placeholders(len(sourceIDs)) + `)`
		for _, id := range sourceIDs {
			args = append(args, id)
		}
	}
	q += ` ORDER BY i.source_id, i.id`

	rows, err := db.sql.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCandidates(rows, cadenceDays)
}

// SourceIDsForFeeds resolves feed slugs to the set of source ids in them.
func (db *DB) SourceIDsForFeeds(ctx context.Context, userID int64, slugs []string) ([]int64, error) {
	if len(slugs) == 0 {
		return nil, nil
	}
	q := `SELECT DISTINCT fs.source_id FROM feed_sources fs
	      JOIN feeds f ON f.id = fs.feed_id
	      WHERE f.user_id = ? AND f.slug IN (` + placeholders(len(slugs)) + `)`
	args := []any{userID}
	for _, s := range slugs {
		args = append(args, s)
	}
	rows, err := db.sql.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (db *DB) ItemsByIDs(ctx context.Context, ids []int64) ([]Item, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	q := `SELECT id, source_id, url, title, summary, content, author, thumbnail_url, media_type, duration_sec, published_at, fetched_at
	      FROM items WHERE id IN (` + placeholders(len(ids)) + `)`
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := db.sql.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanItems(rows)
}

func scanItems(rows *sql.Rows) ([]Item, error) {
	var out []Item
	for rows.Next() {
		var it Item
		var pub, fetched string
		if err := rows.Scan(&it.ID, &it.SourceID, &it.URL, &it.Title, &it.Summary, &it.Content, &it.Author,
			&it.ThumbnailURL, &it.MediaType, &it.DurationSec, &pub, &fetched); err != nil {
			return nil, err
		}
		it.PublishedAt = parseTime(pub)
		it.FetchedAt = parseTime(fetched)
		out = append(out, it)
	}
	return out, rows.Err()
}

// SkipStat is a source's recent engagement: how many of its items the user has
// been shown vs. how many they skipped. Feeds skip-rate downweighting.
type SkipStat struct {
	Shown   int
	Skipped int
}

// SourceAvgDuration returns each source's average *content* duration (seconds)
// over its most recent `window` items that carry a known duration. This is the
// empirical "time per item" for a feed - a comedy-shorts channel averages ~90s,
// a longform channel ~20 min - used to predict how many items a time budget can
// hold. Sources whose items carry no duration (articles) are absent from the
// map; the caller supplies a read/skim default for those.
func (db *DB) SourceAvgDuration(ctx context.Context, userID int64, window int) (map[int64]float64, error) {
	rows, err := db.sql.QueryContext(ctx,
		`WITH ranked AS (
		   SELECT i.source_id, i.duration_sec,
		          ROW_NUMBER() OVER (PARTITION BY i.source_id ORDER BY i.published_at DESC) AS rn
		   FROM items i JOIN sources s ON s.id = i.source_id
		   WHERE s.user_id = ?
		 )
		 SELECT source_id, AVG(duration_sec)
		 FROM ranked
		 WHERE rn <= ? AND duration_sec > 0
		 GROUP BY source_id`, userID, window)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]float64{}
	for rows.Next() {
		var sid int64
		var avg float64
		if err := rows.Scan(&sid, &avg); err != nil {
			return nil, err
		}
		out[sid] = avg
	}
	return out, rows.Err()
}

// SourceSkipStats returns per-source shown/skipped counts from item_state. A
// row in item_state means the item reached the user (surfaced/acted); state
// 'skipped' means they rejected it. This is the behavioral signal the ranker
// uses to bubble down sources the user keeps passing on.
func (db *DB) SourceSkipStats(ctx context.Context, userID int64) (map[int64]SkipStat, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT i.source_id,
		        COUNT(*) AS shown,
		        SUM(CASE WHEN st.state = 'skipped' THEN 1 ELSE 0 END) AS skipped
		 FROM item_state st JOIN items i ON i.id = st.item_id
		 WHERE st.user_id = ? GROUP BY i.source_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]SkipStat{}
	for rows.Next() {
		var sid int64
		var s SkipStat
		if err := rows.Scan(&sid, &s.Shown, &s.Skipped); err != nil {
			return nil, err
		}
		out[sid] = s
	}
	return out, rows.Err()
}

// --- item state + events ---

func (db *DB) SetItemState(ctx context.Context, userID, itemID int64, state string) error {
	_, err := db.sql.ExecContext(ctx,
		`INSERT INTO item_state (user_id, item_id, state, acted_at) VALUES (?, ?, ?, datetime('now'))
		 ON CONFLICT(user_id, item_id) DO UPDATE SET state=excluded.state, acted_at=excluded.acted_at`,
		userID, itemID, state)
	return err
}

// MarkSurfaced records that a set of items was shown in a session (state
// 'surfaced', not overwriting a stronger state like 'liked').
func (db *DB) MarkSurfaced(ctx context.Context, userID int64, itemIDs []int64) error {
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, id := range itemIDs {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO item_state (user_id, item_id, state, surfaced_at)
			 VALUES (?, ?, 'surfaced', datetime('now'))
			 ON CONFLICT(user_id, item_id) DO UPDATE SET surfaced_at=COALESCE(item_state.surfaced_at, excluded.surfaced_at)`,
			userID, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (db *DB) LogEvent(ctx context.Context, userID int64, typ string, itemID, sourceID *int64, sessionID, detail string) error {
	_, err := db.sql.ExecContext(ctx,
		`INSERT INTO events (user_id, type, item_id, source_id, session_id, detail) VALUES (?, ?, ?, ?, ?, ?)`,
		userID, typ, nullInt(itemID), nullInt(sourceID), nullStr(sessionID), detail)
	return err
}

// --- sessions ---

func (db *DB) SaveSession(ctx context.Context, id string, userID int64, low, high int, themes string, itemIDs []int64) error {
	_, err := db.sql.ExecContext(ctx,
		`INSERT INTO sessions (id, user_id, min_low, min_high, themes, item_ids) VALUES (?, ?, ?, ?, ?, ?)`,
		id, userID, low, high, themes, joinInts(itemIDs))
	return err
}

// --- helpers ---

func parseTime(s string) time.Time {
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02T15:04:05Z"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func def(v, d string) string {
	if v == "" {
		return d
	}
	return v
}
func defF(v, d float64) float64 {
	if v == 0 {
		return d
	}
	return v
}
func defI(v, d int) int {
	if v == 0 {
		return d
	}
	return v
}
func nullInt(v *int64) any {
	if v == nil {
		return nil
	}
	return *v
}
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
func joinInts(ids []int64) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = fmt.Sprintf("%d", id)
	}
	return strings.Join(parts, ",")
}
