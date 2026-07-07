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
	"math"
	"strconv"
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
	// #111 vocabulary rename must run BEFORE schema.sql, or its CREATE TABLE IF NOT
	// EXISTS interests/mixes would make empty new-named tables beside the old data.
	if err := renameLegacyConcepts(sdb); err != nil {
		sdb.Close()
		return nil, fmt.Errorf("rename legacy concepts: %w", err)
	}
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

// renameLegacyConcepts performs the #111 vocabulary rename (feed->interest,
// group->mix) on an EXISTING database, in place, BEFORE schema.sql runs. If it
// ran after, schema.sql's CREATE TABLE IF NOT EXISTS interests/mixes would create
// empty new-named tables beside the old data. Each step is guarded on the old
// object existing and the new one not, so it runs exactly once per DB and no-ops
// on a fresh DB (nothing to rename) and on every boot thereafter. The legacy
// feed_sources table is intentionally left untouched (frozen rollback net, #86).
func renameLegacyConcepts(sdb *sql.DB) error {
	ctx := context.Background()
	tableExists := func(name string) (bool, error) {
		var n int
		err := sdb.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&n)
		return n > 0, err
	}
	columnExists := func(table, col string) (bool, error) {
		var n int
		err := sdb.QueryRowContext(ctx, `SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?`, table, col).Scan(&n)
		return n > 0, err
	}
	renameTable := func(from, to string) error {
		o, err := tableExists(from)
		if err != nil {
			return err
		}
		n, err := tableExists(to)
		if err != nil {
			return err
		}
		if o && !n {
			if _, err := sdb.ExecContext(ctx, `ALTER TABLE `+from+` RENAME TO `+to); err != nil {
				return fmt.Errorf("rename table %s->%s: %w", from, to, err)
			}
		}
		return nil
	}
	renameColumn := func(table, from, to string) error {
		t, err := tableExists(table)
		if err != nil || !t {
			return err
		}
		has, err := columnExists(table, from)
		if err != nil {
			return err
		}
		hasNew, err := columnExists(table, to)
		if err != nil {
			return err
		}
		if has && !hasNew {
			if _, err := sdb.ExecContext(ctx, `ALTER TABLE `+table+` RENAME COLUMN `+from+` TO `+to); err != nil {
				return fmt.Errorf("rename %s.%s->%s: %w", table, from, to, err)
			}
		}
		return nil
	}
	// Tables. group_feeds -> mix_interests (its columns are renamed after).
	for _, r := range []struct{ from, to string }{
		{"feeds", "interests"},
		{"groups", "mixes"},
		{"group_feeds", "mix_interests"},
	} {
		if err := renameTable(r.from, r.to); err != nil {
			return err
		}
	}
	// Columns.
	if err := renameColumn("sources", "feed_id", "interest_id"); err != nil {
		return err
	}
	if err := renameColumn("mix_interests", "group_id", "mix_id"); err != nil {
		return err
	}
	if err := renameColumn("mix_interests", "feed_id", "interest_id"); err != nil {
		return err
	}
	// The interest-named index is (re)created in migrate(); drop the old-named one.
	if _, err := sdb.ExecContext(ctx, `DROP INDEX IF EXISTS idx_sources_feed`); err != nil {
		return err
	}
	return nil
}

// migrate applies additive, idempotent schema changes for databases that
// predate a column. schema.sql's CREATE TABLE statements are IF NOT EXISTS, so
// they never touch an existing table - column adds have to run separately.
// SQLite has no ADD COLUMN IF NOT EXISTS, so each add is guarded on
// pragma_table_info. Every migration here must be safe to run on every boot.
func migrate(sdb *sql.DB) error {
	if err := ensureColumn(sdb, "interests", "icon", `ALTER TABLE interests ADD COLUMN icon TEXT NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	if err := ensureColumn(sdb, "interests", "half_life_days", `ALTER TABLE interests ADD COLUMN half_life_days REAL NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	if err := ensureColumn(sdb, "interests", "diversity", `ALTER TABLE interests ADD COLUMN diversity INTEGER NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	// Archive After (session engine v2, #115): expiration window in days.
	if err := ensureColumn(sdb, "interests", "archive_after_days", `ALTER TABLE interests ADD COLUMN archive_after_days INTEGER NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	if err := ensureColumn(sdb, "sources", "archive_after_days", `ALTER TABLE sources ADD COLUMN archive_after_days INTEGER NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	// Auto-archive keywords (#118).
	if err := ensureColumn(sdb, "sources", "archive_keywords", `ALTER TABLE sources ADD COLUMN archive_keywords TEXT NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	// Backfill YouTube Shorts classification from the URL (#117): items with a
	// /shorts/ URL are shorts even though the RSS feed shipped no duration.
	// Condition-idempotent (only touches mis-classified rows); guarded on the items
	// table so it no-ops on a partial DB (a test that sets up only some tables).
	{
		var cols int
		if err := sdb.QueryRowContext(context.Background(),
			`SELECT COUNT(*) FROM pragma_table_info('items') WHERE name IN ('url','media_type')`).Scan(&cols); err != nil {
			return err
		}
		if cols == 2 {
			if _, err := sdb.ExecContext(context.Background(),
				`UPDATE items SET media_type='short' WHERE url LIKE '%/shorts/%' AND media_type != 'short'`); err != nil {
				return err
			}
		}
	}
	// Per-source freshness half-life override (#76): source override > interest > global.
	if err := ensureColumn(sdb, "sources", "half_life_days", `ALTER TABLE sources ADD COLUMN half_life_days REAL NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	// items.content (#58): full article body as raw HTML, rendered in the reader.
	if err := ensureColumn(sdb, "items", "content", `ALTER TABLE items ADD COLUMN content TEXT NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	// items.content_source (#98): provenance of the reader body ('' pending | rss |
	// fetched | external). Added after items.content so the backfill below can read
	// both columns. Idempotent-safe on every boot.
	if err := ensureColumn(sdb, "items", "content_source", `ALTER TABLE items ADD COLUMN content_source TEXT NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	// One-time backfill (#98): an existing non-empty body came from the interest, so
	// mark it 'rss'. WHERE content_source = '' makes it idempotent - it only fills
	// rows still at the default and never fights a later fetched/external marking.
	if err := backfillContentSource(sdb); err != nil {
		return err
	}
	// Durable sessions (#67): single duration, read cursor, lifecycle status.
	if err := ensureColumn(sdb, "sessions", "duration_min", `ALTER TABLE sessions ADD COLUMN duration_min INTEGER NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	if err := ensureColumn(sdb, "sessions", "cursor", `ALTER TABLE sessions ADD COLUMN cursor INTEGER NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	if err := ensureColumn(sdb, "sessions", "status", `ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`); err != nil {
		return err
	}
	// One-interest model (#86): sources.interest_id. SQLite permits ADD COLUMN with a
	// REFERENCES clause only when the added column's default is NULL, which this is.
	if err := ensureColumn(sdb, "sources", "interest_id", `ALTER TABLE sources ADD COLUMN interest_id INTEGER REFERENCES interests(id) ON DELETE SET NULL`); err != nil {
		return err
	}
	// Index created here (not schema.sql) so it runs AFTER the status column is
	// ensured on a pre-existing sessions table. See schema.sql note. Guarded on
	// the table existing so migrate() stays safe against a partial DB (e.g. a
	// test that sets up only the interests table), matching ensureColumn's contract.
	if err := ensureIndexIfTable(sdb, "sessions", `CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON sessions(user_id, status)`); err != nil {
		return err
	}
	// Mix tier (#86): mixes + mix_interests. CREATE TABLE IF NOT EXISTS is safe on
	// every boot; forward FK references (users/interests) are resolved at write time, so
	// creating these before those tables exist (a partial test DB) is fine.
	if _, err := sdb.Exec(`CREATE TABLE IF NOT EXISTS mixes (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name       TEXT NOT NULL,
		slug       TEXT NOT NULL,
		icon       TEXT NOT NULL DEFAULT '',
		sort       INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		UNIQUE (user_id, slug)
	)`); err != nil {
		return err
	}
	if _, err := sdb.Exec(`CREATE TABLE IF NOT EXISTS mix_interests (
		mix_id INTEGER NOT NULL REFERENCES mixes(id) ON DELETE CASCADE,
		interest_id  INTEGER NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
		PRIMARY KEY (mix_id, interest_id)
	)`); err != nil {
		return err
	}
	// Back-populate sources.interest_id from the single legacy feed_sources membership
	// (#86). Idempotent: only fills rows still NULL, so it never fights a later
	// picker change. Guarded on both tables existing (a partial test DB may have
	// neither). feed_sources is left intact for rollback; this is its last reader.
	if err := populateSourceInterestID(sdb); err != nil {
		return err
	}
	// Index on the migrated column, created after the column is guaranteed present.
	return ensureIndexIfTable(sdb, "sources", `CREATE INDEX IF NOT EXISTS idx_sources_interest ON sources(interest_id)`)
}

// ensureIndexIfTable creates an index only when its table exists, so migrate()
// stays safe against a partial DB (a test that set up only a subset of tables).
// The DDL itself is CREATE INDEX IF NOT EXISTS, so it's also safe to re-run.
func ensureIndexIfTable(sdb *sql.DB, table, ddl string) error {
	var n int
	if err := sdb.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?`, table).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	_, err := sdb.Exec(ddl)
	return err
}

// populateSourceInterestID back-fills sources.interest_id from the legacy feed_sources
// table (#86): each source's single membership becomes its one interest. WHERE
// interest_id IS NULL makes it idempotent (a re-run touches nothing) and non-
// destructive to any assignment made through the new picker. Guarded on both
// tables so it no-ops on a partial DB.
func populateSourceInterestID(sdb *sql.DB) error {
	for _, t := range []string{"sources", "feed_sources"} {
		var n int
		if err := sdb.QueryRowContext(context.Background(),
			`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?`, t).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return nil
		}
	}
	// feed_sources is a frozen legacy table (#86) - its column stays feed_id even
	// though the target sources.interest_id was renamed. Read the legacy column.
	_, err := sdb.Exec(`UPDATE sources
		SET interest_id = (SELECT fs.feed_id FROM feed_sources fs WHERE fs.source_id = sources.id LIMIT 1)
		WHERE interest_id IS NULL`)
	return err
}

// backfillContentSource marks every existing item that already has a body as
// 'rss' (#98): before this column existed, a non-empty content came from the
// interest. WHERE content_source = ” makes it idempotent and non-destructive - it
// only touches rows still at the default, so a later fetched/external marking is
// never clobbered. Guarded on the items table existing so it no-ops on a partial
// DB. Runs after the items.content and items.content_source columns are ensured.
func backfillContentSource(sdb *sql.DB) error {
	var n int
	if err := sdb.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='items'`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	_, err := sdb.Exec(`UPDATE items SET content_source = 'rss' WHERE content != '' AND content_source = ''`)
	return err
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

// --- interests ---

func (db *DB) ListInterests(ctx context.Context, userID int64) ([]Interest, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT f.id, f.name, f.slug, f.color, f.icon, f.half_life_days, f.diversity, f.archive_after_days, f.sort, f.created_at,
		        (SELECT COUNT(*) FROM sources s WHERE s.interest_id = f.id) AS source_count
		 FROM interests f WHERE f.user_id = ? ORDER BY f.sort, f.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Interest
	for rows.Next() {
		var f Interest
		var created string
		if err := rows.Scan(&f.ID, &f.Name, &f.Slug, &f.Color, &f.Icon, &f.HalfLifeDays, &f.Diversity, &f.ArchiveAfterDays, &f.Sort, &created, &f.SourceCount); err != nil {
			return nil, err
		}
		f.CreatedAt = parseTime(created)
		out = append(out, f)
	}
	return out, rows.Err()
}

func (db *DB) CreateInterest(ctx context.Context, userID int64, name, slug, color string) (*Interest, error) {
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO interests (user_id, name, slug, color) VALUES (?, ?, ?, ?)`,
		userID, name, slug, color)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Interest{ID: id, UserID: userID, Name: name, Slug: slug, Color: color}, nil
}

// GetOrCreateInterest returns the interest with this slug, creating it if absent. Used
// by import to turn OPML folders into interests without duplicating.
func (db *DB) GetOrCreateInterest(ctx context.Context, userID int64, name, slug, color string) (*Interest, error) {
	var f Interest
	err := db.sql.QueryRowContext(ctx,
		`SELECT id, name, slug, color FROM interests WHERE user_id = ? AND slug = ?`, userID, slug).
		Scan(&f.ID, &f.Name, &f.Slug, &f.Color)
	if err == nil {
		return &f, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	return db.CreateInterest(ctx, userID, name, slug, color)
}

// Videos interest (#53): the auto-grouping bucket for untagged YouTube sources.
const (
	videosInterestName = "Videos"
	videosInterestSlug = "videos"
	videosInterestIcon = "film" // Clapperboard glyph; see web/src/lib/feedIcons.ts
	// videosBackfillKey gates the one-time untagged-YouTube grouping so it runs
	// exactly once and never re-mixes sources Fisher later pulls out by hand.
	videosBackfillKey = "videos_backfill_done"
)

// GetOrCreateVideosInterest returns the user's Videos interest, creating it (with the
// film icon) if absent. Idempotent via the (user_id, slug) unique constraint;
// if the interest already exists its name/icon are left untouched so a later manual
// rename or re-icon survives.
func (db *DB) GetOrCreateVideosInterest(ctx context.Context, userID int64) (*Interest, error) {
	if _, err := db.sql.ExecContext(ctx,
		`INSERT INTO interests (user_id, name, slug, icon) VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, slug) DO NOTHING`,
		userID, videosInterestName, videosInterestSlug, videosInterestIcon); err != nil {
		return nil, err
	}
	var f Interest
	err := db.sql.QueryRowContext(ctx,
		`SELECT id, name, slug, color, icon FROM interests WHERE user_id = ? AND slug = ?`,
		userID, videosInterestSlug).Scan(&f.ID, &f.Name, &f.Slug, &f.Color, &f.Icon)
	if err != nil {
		return nil, err
	}
	f.UserID = userID
	return &f, nil
}

// BackfillVideosInterest is a one-time, marker-guarded migration (#53): it ensures
// the Videos interest exists and assigns every youtube-kind source that currently
// belongs to NO interest to it. Guarded by the kv 'videos_backfill_done' flag so it
// runs exactly once per user and never re-mixes sources later pulled out.
// Returns the number of sources assigned (0 on every run after the first).
func (db *DB) BackfillVideosInterest(ctx context.Context, userID int64) (int, error) {
	if _, done, err := db.kvGet(ctx, userID, videosBackfillKey); err != nil {
		return 0, err
	} else if done {
		return 0, nil
	}
	f, err := db.GetOrCreateVideosInterest(ctx, userID)
	if err != nil {
		return 0, err
	}
	res, err := db.sql.ExecContext(ctx,
		`UPDATE sources SET interest_id = ?
		 WHERE user_id = ? AND kind = 'youtube' AND interest_id IS NULL`,
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

// --- user settings (#68) ---
//
// Settings are persisted in the existing kv table (one row per user+key), so
// there is no schema migration to run - `CREATE TABLE IF NOT EXISTS kv` in
// schema.sql runs on every boot and covers old databases. Each setting has a
// hard-coded default applied when the key is absent, so a fresh user gets the
// intended defaults without a seed step.

const (
	settingFastScrollCheckin = "fast_scroll_checkin"
)

// Settings is the user's toggleable preferences. FastScrollCheckin gates the
// dwell/engagement measurement + the fast-scroll check-in nudge (#68). Default
// on; off = the old explicit-signals-only behavior (no dwell measured, no nudge).
//
// The #76 multi-interest half-life rule was deleted in #86: a source now belongs to
// exactly one interest, so half-life resolution is simply source override > that one
// interest > global - there is no "which interest" ambiguity left to configure.
type Settings struct {
	FastScrollCheckin bool `json:"fast_scroll_checkin"`
}

// GetSettings returns the user's settings with defaults filled in for any key
// that has never been written.
func (db *DB) GetSettings(ctx context.Context, userID int64) (Settings, error) {
	s := Settings{FastScrollCheckin: true} // defaults
	v, ok, err := db.kvGet(ctx, userID, settingFastScrollCheckin)
	if err != nil {
		return s, err
	}
	if ok {
		s.FastScrollCheckin = v == "1"
	}
	return s, nil
}

// SetFastScrollCheckin persists the fast-scroll check-in toggle.
func (db *DB) SetFastScrollCheckin(ctx context.Context, userID int64, on bool) error {
	v := "0"
	if on {
		v = "1"
	}
	return db.kvSet(ctx, userID, settingFastScrollCheckin, v)
}

// UpdateInterest patches a interest's presentation fields (name, color, icon) and the
// per-interest ranker overrides (half-life, diversity). Only non-nil fields are
// applied. Scoped to the owning user.
func (db *DB) UpdateInterest(ctx context.Context, userID, id int64, name, color, icon *string, halfLifeDays *float64, diversity *int, archiveAfterDays *int) error {
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
	// Archive After default for this interest's sources (#115).
	if archiveAfterDays != nil {
		sets = append(sets, "archive_after_days = ?")
		args = append(args, *archiveAfterDays)
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id, userID)
	_, err := db.sql.ExecContext(ctx,
		`UPDATE interests SET `+strings.Join(sets, ", ")+` WHERE id = ? AND user_id = ?`, args...)
	return err
}

// InterestsForSources resolves the one interest each of the given sources belongs to
// (#86), for the session card's identity line and the insights rollup. A source with
// a interest maps to that interest's InterestRef; a interestless source (interest_id NULL) is absent
// from the map (the card then renders source-only).
func (db *DB) InterestsForSources(ctx context.Context, userID int64, sourceIDs []int64) (map[int64]InterestRef, error) {
	out := map[int64]InterestRef{}
	if len(sourceIDs) == 0 {
		return out, nil
	}
	q := `SELECT s.id, f.name, f.slug, f.color, f.icon
	      FROM sources s JOIN interests f ON f.id = s.interest_id
	      WHERE s.user_id = ? AND s.id IN (` + placeholders(len(sourceIDs)) + `)`
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
		var f InterestRef
		if err := rows.Scan(&sid, &f.Name, &f.Slug, &f.Color, &f.Icon); err != nil {
			return nil, err
		}
		out[sid] = f
	}
	return out, rows.Err()
}

// SetSourceInterest sets the one interest a source belongs to (#86), by slug. An empty
// slug clears the interest (interestless). An unknown slug is a no-op that leaves the
// source unchanged. Scoped to the owning user.
func (db *DB) SetSourceInterest(ctx context.Context, userID, sourceID int64, slug string) error {
	var owner int64
	if err := db.sql.QueryRowContext(ctx, `SELECT user_id FROM sources WHERE id = ?`, sourceID).Scan(&owner); err != nil {
		return err
	}
	if owner != userID {
		return fmt.Errorf("source %d not owned by user", sourceID)
	}
	if slug == "" {
		_, err := db.sql.ExecContext(ctx,
			`UPDATE sources SET interest_id = NULL WHERE id = ? AND user_id = ?`, sourceID, userID)
		return err
	}
	var interestID int64
	err := db.sql.QueryRowContext(ctx,
		`SELECT id FROM interests WHERE user_id = ? AND slug = ?`, userID, slug).Scan(&interestID)
	if err == sql.ErrNoRows {
		return nil // unknown slug: leave the source as-is
	}
	if err != nil {
		return err
	}
	_, err = db.sql.ExecContext(ctx,
		`UPDATE sources SET interest_id = ? WHERE id = ? AND user_id = ?`, interestID, sourceID, userID)
	return err
}

// AssignSourceInterest sets a source's one interest by interest id (#86). Used by import and
// the Videos backfill, which already hold the interest id. No-op guards live in the
// callers; this is a plain scoped update.
func (db *DB) AssignSourceInterest(ctx context.Context, sourceID, interestID int64) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE sources SET interest_id = ? WHERE id = ?`, interestID, sourceID)
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
	// Already existed - fetch its id so it can still be added to a interest.
	err = db.sql.QueryRowContext(ctx,
		`SELECT id FROM sources WHERE user_id = ? AND feed_url = ?`, s.UserID, s.FeedURL).Scan(&id)
	return id, false, err
}

// SetInterestSources sets this interest as the one interest for exactly the given sources
// (#86). Because a source belongs to a single interest, this both clears the interest's
// previous members (interest_id -> NULL) and claims the listed ones - assigning a
// source here removes it from whatever interest it was in before. Scoped to the user.
func (db *DB) SetInterestSources(ctx context.Context, userID, interestID int64, sourceIDs []int64) error {
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Release the current members of this interest.
	if _, err := tx.ExecContext(ctx,
		`UPDATE sources SET interest_id = NULL WHERE interest_id = ? AND user_id = ?`, interestID, userID); err != nil {
		return err
	}
	// Claim the listed sources for this interest.
	for _, sid := range sourceIDs {
		if _, err := tx.ExecContext(ctx,
			`UPDATE sources SET interest_id = ? WHERE id = ? AND user_id = ?`, interestID, sid, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// --- sources ---

func (db *DB) ListSources(ctx context.Context, userID int64) ([]Source, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT s.id, s.kind, s.title, s.feed_url, s.homepage_url, s.icon_url, s.weight,
		        s.state, s.trial_until, s.per_session_cap, s.half_life_days, s.archive_after_days, s.archive_keywords, s.added_at, s.last_fetch_at, s.fetch_error,
		        s.interest_id, f.slug,
		        (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id) AS item_count,
		        (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id
		           AND NOT EXISTS (SELECT 1 FROM item_state st WHERE st.item_id = i.id AND st.user_id = ?)) AS unseen_count,
		        (SELECT COALESCE(CAST(SUM(CASE WHEN st.state='skipped' THEN 1 ELSE 0 END) AS REAL)
		           / NULLIF(COUNT(*), 0), 0)
		         FROM item_state st JOIN items i2 ON i2.id = st.item_id
		         WHERE i2.source_id = s.id AND st.user_id = ?) AS skip_pct,
		        (SELECT COUNT(*) / 30.0 FROM items i3
		         WHERE i3.source_id = s.id AND i3.published_at >= datetime('now', '-30 days')) AS posts_per_day
		 FROM sources s LEFT JOIN interests f ON f.id = s.interest_id
		 WHERE s.user_id = ? ORDER BY s.title`, userID, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Source
	for rows.Next() {
		s, err := scanSource(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSource(r rowScanner) (*Source, error) {
	var s Source
	var added string
	var trialUntil, lastFetch, interestSlug sql.NullString
	var interestID sql.NullInt64
	if err := r.Scan(&s.ID, &s.Kind, &s.Title, &s.FeedURL, &s.HomepageURL, &s.IconURL, &s.Weight,
		&s.State, &trialUntil, &s.PerSessionCap, &s.HalfLifeDays, &s.ArchiveAfterDays, &s.ArchiveKeywords, &added, &lastFetch, &s.FetchError,
		&interestID, &interestSlug,
		&s.ItemCount, &s.UnseenCount, &s.SkipPct, &s.PostsPerDay); err != nil {
		return nil, err
	}
	if interestID.Valid {
		s.InterestID = &interestID.Int64
	}
	s.InterestSlug = interestSlug.String
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

// UpdateSource patches weight, state, per_session_cap, half_life_days, title.
// Only non-nil fields are applied.
func (db *DB) UpdateSource(ctx context.Context, userID, id int64, weight *float64, state *string, cap *int, halfLifeDays *float64, title *string, archiveAfterDays *int, archiveKeywords *string) error {
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
	if halfLifeDays != nil {
		sets = append(sets, "half_life_days = ?")
		args = append(args, *halfLifeDays)
	}
	if title != nil {
		sets = append(sets, "title = ?")
		args = append(args, *title)
	}
	// Session engine v2 (#115/#118): Archive-After window + auto-archive keywords.
	if archiveAfterDays != nil {
		sets = append(sets, "archive_after_days = ?")
		args = append(args, *archiveAfterDays)
	}
	if archiveKeywords != nil {
		sets = append(sets, "archive_keywords = ?")
		args = append(args, *archiveKeywords)
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
// true only when a genuinely new row was inserted, so the ingest "new_items"
// count stays accurate.
//
// For an item that already exists, it backfills content when the stored content
// is empty (#58): pre-#58 items - and items ingested before a interest started
// shipping content:encoded - gain their full body on the next re-fetch, without
// clobbering an already-populated body or touching any other column. Interests
// truncate to ~15 recent entries, so this reaches exactly the recent,
// session-surfaced items; older ones age out still empty, which is fine.
//
// A backfill is deliberately a separate UPDATE rather than an ON CONFLICT DO
// UPDATE: SQLite's RowsAffected reports 1 for both a fresh insert and a
// WHERE-satisfied upsert-update, so folding the two into one statement would let
// a backfill masquerade as a new insert. Keeping the insert on ON CONFLICT DO
// NOTHING preserves the exact rows-affected isNew derivation. Interaction state
// lives in item_state/events, never in items, so a backfill can't disturb
// seen/skip history.
func (db *DB) UpsertItem(ctx context.Context, it *Item) (bool, error) {
	res, err := db.sql.ExecContext(ctx,
		`INSERT INTO items (source_id, external_id, url, title, summary, content, content_source, author, thumbnail_url, media_type, duration_sec, published_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(source_id, external_id) DO NOTHING`,
		it.SourceID, it.ExternalID, it.URL, it.Title, it.Summary, it.Content, it.ContentSource, it.Author, it.ThumbnailURL,
		def(it.MediaType, "unknown"), it.DurationSec, it.PublishedAt.UTC().Format(time.RFC3339))
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return true, nil // genuinely new insert
	}
	// Existing row: backfill content only when it's empty and we actually have a
	// body to write. The interest shipped it, so mark it 'rss' in the same update -
	// this reclaims an item earlier resolved to 'external' if the interest later starts
	// carrying the body. Once content is non-empty the WHERE guard makes it a no-op.
	if it.Content != "" {
		if _, err := db.sql.ExecContext(ctx,
			`UPDATE items SET content = ?, content_source = 'rss' WHERE source_id = ? AND external_id = ? AND content = ''`,
			it.Content, it.SourceID, it.ExternalID); err != nil {
			return false, err
		}
	}
	return false, nil
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
		`SELECT id, source_id, url, title, summary, content, content_source, author, thumbnail_url, media_type, duration_sec, published_at, fetched_at
		 FROM items WHERE source_id = ? ORDER BY published_at DESC LIMIT ?`, sourceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanItems(rows)
}

// ListRecentItemsByInterest returns recent items across every source in a interest
// (by id), newest first. Backs the interest page's "recent posts" section (#66):
// one query instead of fanning sourceItems per source. Read-only orientation -
// no seen/skip events, like ListRecentItemsBySource. Interest id (not slug) so the
// route param name stays consistent with the sibling /interests/{id}/sources route
// (chi conflicts on mismatched wildcard names).
func (db *DB) ListRecentItemsByInterest(ctx context.Context, userID, interestID int64, limit int) ([]Item, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT i.id, i.source_id, i.url, i.title, i.summary, i.content, i.content_source, i.author, i.thumbnail_url,
		        i.media_type, i.duration_sec, i.published_at, i.fetched_at
		 FROM items i
		 JOIN sources s ON s.id = i.source_id
		 WHERE s.user_id = ? AND s.interest_id = ?
		 ORDER BY i.published_at DESC LIMIT ?`, userID, interestID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanItems(rows)
}

// candidateCols builds the shared projection for Candidates, InsightsItems, and
// CandidatesByIDs: item + source facts, the source's own half-life override
// (s.half_life_days, #76), the accumulated-history cadence inputs
// (win_count/win_span), and the source's one-interest ranker overrides (half-life +
// diversity, #86). Since a source belongs to exactly one interest, the resolution is
// a direct lookup on s.interest_id - no multi-interest rule. A interestless source (interest_id
// NULL) COALESCEs to 0 (global defaults). All callers must select these in this
// order so scanCandidates can read any result set. The two ? placeholders are the
// cadence-window bound, twice; arg alignment is identical across callers.
func candidateCols() string {
	return `i.id, i.source_id, i.url, i.title, i.summary, i.content, i.content_source, i.author, i.thumbnail_url,
	             i.media_type, i.duration_sec, i.published_at, i.fetched_at,
	             s.title, s.weight, s.per_session_cap, s.half_life_days, s.archive_after_days, s.archive_keywords,
	             (SELECT COUNT(*) FROM items i2 WHERE i2.source_id = s.id
	                AND i2.published_at >= datetime('now', ?)) AS win_count,
	             (SELECT COALESCE(julianday('now') - julianday(MIN(i2.published_at)), 0)
	                FROM items i2 WHERE i2.source_id = s.id
	                AND i2.published_at >= datetime('now', ?)) AS win_span,
	             COALESCE((SELECT f.half_life_days FROM interests f WHERE f.id = s.interest_id), 0) AS interest_half_life,
	             COALESCE((SELECT f.diversity FROM interests f WHERE f.id = s.interest_id), 0) AS interest_diversity,
	             COALESCE((SELECT f.archive_after_days FROM interests f WHERE f.id = s.interest_id), 0) AS interest_archive_after`
}

// cadence-estimation constants. cadencePerDay powers the informational
// posts/day figure; engine v2 no longer derives rarity from it (#114).
const (
	// minObservationDays floors the divisor so a dense burst in a short window (a
	// just-added high-volume source) reads as high-cadence, and we never divide by ~0.
	minObservationDays = 1.0
)

// cadencePerDay estimates a source's posting rate from its ACCUMULATED stored
// items: count within the window over the observed span (now - earliest item in
// the window), not the fixed window. otium stores every item it ever fetches, so
// this history accrues past a interest's ~10-15 entry truncation. Dividing by the
// observed span rather than the full window keeps a high-volume source whose interest
// only exposes a recent slice from reading as rare once even a little history has
// accumulated (the NPR-labeled-rare bug). No thin-history floor (#110): a source
// we've seen little of reads at its actual low rate so it ranks as rare among the
// user's sources, which is the point. count 0 -> 0 (maximally rare, but inert:
// such a source carries no candidates).
func cadencePerDay(count int, spanDays float64, windowDays int) float64 {
	if count <= 0 {
		return 0
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
// rarity window) and carrying the resolved primary-interest overrides.
func scanCandidates(rows *sql.Rows, windowDays int) ([]Candidate, error) {
	var out []Candidate
	for rows.Next() {
		var c Candidate
		var pub, fetched string
		var winCount int
		var winSpan, halfLife float64
		var diversity int
		if err := rows.Scan(&c.ID, &c.SourceID, &c.URL, &c.Title, &c.Summary, &c.Content, &c.ContentSource, &c.Author, &c.ThumbnailURL,
			&c.MediaType, &c.DurationSec, &pub, &fetched,
			&c.SourceTitle, &c.SourceWeight, &c.PerSessionCap, &c.SourceHalfLifeDays, &c.SourceArchiveAfterDays, &c.SourceArchiveKeywords,
			&winCount, &winSpan, &halfLife, &diversity, &c.InterestArchiveAfterDays); err != nil {
			return nil, err
		}
		c.PublishedAt = parseTime(pub)
		c.FetchedAt = parseTime(fetched)
		c.SourceCadence = cadencePerDay(winCount, winSpan, windowDays)
		c.InterestHalfLifeDays = halfLife
		c.InterestDiversity = diversity
		out = append(out, c)
	}
	return out, rows.Err()
}

// Candidates returns unseen items from the given sources (or all followed
// sources if sourceIDs is empty), newest first, as ranker input. It computes
// each source's cadence from accumulated stored history in the same pass.
func (db *DB) Candidates(ctx context.Context, userID int64, sourceIDs []int64, sinceDays, limit int) ([]Candidate, error) {
	q := `SELECT ` + candidateCols() + `
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

// InsightsItems returns every item belonging to the user's followed/trial sources
// (optionally restricted to sourceIDs), each carrying the source facts the
// scorer needs (title, weight, recent cadence). Unlike Candidates it does NOT
// filter to unseen items and applies no row limit: the insights view sums the current
// freshness-decayed score of ALL known items, so stale items fall out through
// decay, not a WHERE clause. cadenceDays sets the rarity-boost cadence window, to
// match the session builder's rarity semantics. Rows are ordered deterministically.
func (db *DB) InsightsItems(ctx context.Context, userID int64, sourceIDs []int64, cadenceDays int) ([]Candidate, error) {
	q := `SELECT ` + candidateCols() + `
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

// SourceIDsForInterests resolves interest slugs to the set of source ids in them (#86:
// a source's one interest).
func (db *DB) SourceIDsForInterests(ctx context.Context, userID int64, slugs []string) ([]int64, error) {
	if len(slugs) == 0 {
		return nil, nil
	}
	q := `SELECT s.id FROM sources s
	      JOIN interests f ON f.id = s.interest_id
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
	q := `SELECT id, source_id, url, title, summary, content, content_source, author, thumbnail_url, media_type, duration_sec, published_at, fetched_at
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

// GetItem returns a single item scoped to the owning user (via its source), or
// (nil, nil) when it doesn't exist or isn't the user's. Carries content_source
// so the on-demand full-text endpoint (#98) can decide fetch vs. return-cached
// without a second read.
func (db *DB) GetItem(ctx context.Context, userID, id int64) (*Item, error) {
	row := db.sql.QueryRowContext(ctx,
		`SELECT i.id, i.source_id, i.url, i.title, i.summary, i.content, i.content_source, i.author,
		        i.thumbnail_url, i.media_type, i.duration_sec, i.published_at, i.fetched_at
		 FROM items i JOIN sources s ON s.id = i.source_id
		 WHERE i.id = ? AND s.user_id = ?`, id, userID)
	var it Item
	var pub, fetched string
	err := row.Scan(&it.ID, &it.SourceID, &it.URL, &it.Title, &it.Summary, &it.Content, &it.ContentSource,
		&it.Author, &it.ThumbnailURL, &it.MediaType, &it.DurationSec, &pub, &fetched)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	it.PublishedAt = parseTime(pub)
	it.FetchedAt = parseTime(fetched)
	return &it, nil
}

// SetItemContent stores an on-demand extracted body and its provenance (#98):
// the readability HTML plus content_source ('fetched'). Persisting this is the
// cache - the endpoint fetches an item's URL exactly once.
func (db *DB) SetItemContent(ctx context.Context, id int64, content, source string) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE items SET content = ?, content_source = ? WHERE id = ?`, content, source, id)
	return err
}

// SetItemContentSource records an item's content provenance without a body (#98),
// e.g. marking it 'external' when extraction fails or the item is a video/audio/
// paywalled page. Also persists the once-only decision so we don't re-fetch.
func (db *DB) SetItemContentSource(ctx context.Context, id int64, source string) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE items SET content_source = ? WHERE id = ?`, source, id)
	return err
}

func scanItems(rows *sql.Rows) ([]Item, error) {
	var out []Item
	for rows.Next() {
		var it Item
		var pub, fetched string
		if err := rows.Scan(&it.ID, &it.SourceID, &it.URL, &it.Title, &it.Summary, &it.Content, &it.ContentSource, &it.Author,
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
// been shown vs. how many they skipped. Interests skip-rate downweighting.
type SkipStat struct {
	Shown   int
	Skipped int
}

// SourceAvgDuration returns each source's average *content* duration (seconds)
// over its most recent `window` items that carry a known duration. This is the
// empirical "time per item" for a interest - a comedy-shorts channel averages ~90s,
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
// ResetSourceMetadata clears the user's engagement state for a source's items
// (#119): every item becomes unread again. With olderThan set, only items
// published before that instant are reset (e.g. "mark everything older than a
// week unread"). Scoped to the owning user via the source check.
func (db *DB) ResetSourceMetadata(ctx context.Context, userID, sourceID int64, olderThan *time.Time) error {
	var owns int
	if err := db.sql.QueryRowContext(ctx, `SELECT COUNT(*) FROM sources WHERE id=? AND user_id=?`, sourceID, userID).Scan(&owns); err != nil {
		return err
	}
	if owns == 0 {
		return nil
	}
	q := `DELETE FROM item_state WHERE user_id=? AND item_id IN (SELECT id FROM items WHERE source_id=?`
	args := []any{userID, sourceID}
	if olderThan != nil {
		q += ` AND published_at < ?`
		args = append(args, olderThan.UTC().Format("2006-01-02T15:04:05Z"))
	}
	q += `)`
	_, err := db.sql.ExecContext(ctx, q, args...)
	return err
}

// ReplaceSourceFeedURL swaps a source's RSS URL in place (#119), keeping all local
// items/metadata. Naive by design: e.g. a Patreon upgrade to a private full-text
// feed. Scoped to the owning user.
func (db *DB) ReplaceSourceFeedURL(ctx context.Context, userID, sourceID int64, url string) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE sources SET feed_url=? WHERE id=? AND user_id=?`, url, sourceID, userID)
	return err
}

// SourceStatsView is the per-source transparency bundle the management UI reads
// (#116): supply (total/unseen/on-deck), publishing rate, and the engagement
// lifecycle (shown/skipped/opened/liked). Derived from items + item_state; the
// events log remains the immutable audit trail behind these.
type SourceStatsView struct {
	SourceID  int64   `json:"source_id"`
	Total     int     `json:"total"`     // all items ever fetched
	Unseen    int     `json:"unseen"`    // no item_state row yet
	OnDeck    int     `json:"on_deck"`   // unseen and within the global archive window (approx)
	Shown     int     `json:"shown"`     // has any item_state (presented)
	Skipped   int     `json:"skipped"`   // presented then skipped
	Opened    int     `json:"opened"`    // presented then opened/read
	Liked     int     `json:"liked"`     // liked
	PerDay    float64 `json:"per_day"`   // publishing rate over accumulated history
	Invisible int     `json:"invisible"` // items never presented (unseen); == Total - Shown
	SkipPct   float64 `json:"skip_pct"`  // skipped / shown, 0 when nothing shown
	OpenPct   float64 `json:"open_pct"`  // opened / shown
}

// SourceStatsAll returns the stats bundle for every one of the user's sources in a
// single pass. on_deck approximates "eligible unseen" with the global Archive-After
// window (per-source override + keyword filtering are applied by the ranker; this
// is the cheap headline figure). per_day is items over the observed span.
func (db *DB) SourceStatsAll(ctx context.Context, userID int64) (map[int64]SourceStatsView, error) {
	rows, err := db.sql.QueryContext(ctx,
		`SELECT i.source_id,
		        COUNT(*) AS total,
		        SUM(CASE WHEN st.item_id IS NULL THEN 1 ELSE 0 END) AS unseen,
		        SUM(CASE WHEN st.item_id IS NOT NULL THEN 1 ELSE 0 END) AS shown,
		        SUM(CASE WHEN st.state = 'skipped' THEN 1 ELSE 0 END) AS skipped,
		        SUM(CASE WHEN st.state = 'opened' THEN 1 ELSE 0 END) AS opened,
		        SUM(CASE WHEN st.state = 'liked' THEN 1 ELSE 0 END) AS liked,
		        SUM(CASE WHEN st.item_id IS NULL AND i.published_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS on_deck,
		        COALESCE(julianday('now') - julianday(MIN(i.published_at)), 0) AS span_days
		 FROM sources s
		 JOIN items i ON i.source_id = s.id
		 LEFT JOIN item_state st ON st.item_id = i.id AND st.user_id = ?
		 WHERE s.user_id = ?
		 GROUP BY i.source_id`,
		fmt.Sprintf("-%d days", globalArchiveWindowDays), userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]SourceStatsView{}
	for rows.Next() {
		var v SourceStatsView
		var span float64
		if err := rows.Scan(&v.SourceID, &v.Total, &v.Unseen, &v.Shown, &v.Skipped, &v.Opened, &v.Liked, &v.OnDeck, &span); err != nil {
			return nil, err
		}
		v.Invisible = v.Unseen
		if span < 1 {
			span = 1
		}
		v.PerDay = round1(float64(v.Total) / span)
		if v.Shown > 0 {
			v.SkipPct = round2f(float64(v.Skipped) / float64(v.Shown))
			v.OpenPct = round2f(float64(v.Opened) / float64(v.Shown))
		}
		out[v.SourceID] = v
	}
	return out, rows.Err()
}

// globalArchiveWindowDays mirrors session.globalArchiveAfterDays for the on-deck
// headline figure (the store can't import session).
const globalArchiveWindowDays = 21

func round1(f float64) float64  { return math.Round(f*10) / 10 }
func round2f(f float64) float64 { return math.Round(f*100) / 100 }

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

// --- history (#83) ---

// History returns the user's items paired with their interaction, newest
// interaction first, for the personal history view. It is a read-only join over
// item_state (the one row per user+item that carries state + timestamps); it
// never writes and the ranker never calls it, so it can't perturb ranking.
//
// The filter selects which slice of item_state to return and which timestamp
// defines "newest interaction":
//   - "shown"  = every item that reached the user (any item_state row), ordered
//     by when it was surfaced (surfaced_at, falling back to acted_at for rows
//     with no surface time, e.g. a direct save).
//   - "read"   = engaged: opened OR liked OR saved, ordered by acted_at.
//   - "liked"  = state 'liked', ordered by acted_at.
//   - "saved"  = state 'saved', ordered by acted_at.
//
// item_state.state is last-write-wins, so an item liked and later saved reads as
// 'saved' - it appears under "saved" (and "read"), not "liked". That matches the
// UI's "current interaction" framing. An unknown filter is treated as "shown".
//
// The table is one row per (user, item) and single-user in practice, so it stays
// small; no dedicated index is warranted (the user_id PK prefix already scopes
// the scan). limit is clamped by the caller; offset drives "load more".
func (db *DB) History(ctx context.Context, userID int64, filter string, limit, offset int) ([]HistoryItem, error) {
	var where, orderTS string
	switch filter {
	case "read":
		where = "st.state IN ('opened','liked','saved')"
		orderTS = "st.acted_at"
	case "liked":
		where = "st.state = 'liked'"
		orderTS = "st.acted_at"
	case "saved":
		where = "st.state = 'saved'"
		orderTS = "st.acted_at"
	default: // "shown" and anything unknown
		where = "1=1"
		orderTS = "COALESCE(st.surfaced_at, st.acted_at)"
	}
	q := fmt.Sprintf(`SELECT i.id, i.source_id, i.url, i.title, i.summary, i.content, i.content_source, i.author, i.thumbnail_url,
	        i.media_type, i.duration_sec, i.published_at, i.fetched_at,
	        st.state, %[1]s AS interacted_at
	    FROM item_state st JOIN items i ON i.id = st.item_id
	    WHERE st.user_id = ? AND %[2]s
	    ORDER BY interacted_at DESC, i.id DESC
	    LIMIT ? OFFSET ?`, orderTS, where)
	rows, err := db.sql.QueryContext(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []HistoryItem
	for rows.Next() {
		var h HistoryItem
		var pub, fetched, at string
		if err := rows.Scan(&h.ID, &h.SourceID, &h.URL, &h.Title, &h.Summary, &h.Content, &h.ContentSource, &h.Author,
			&h.ThumbnailURL, &h.MediaType, &h.DurationSec, &pub, &fetched, &h.State, &at); err != nil {
			return nil, err
		}
		h.PublishedAt = parseTime(pub)
		h.FetchedAt = parseTime(fetched)
		h.InteractedAt = parseTime(at)
		out = append(out, h)
	}
	return out, rows.Err()
}

// --- sessions ---
//
// A session is durable and stateful (#67): the built queue (item_ids) and the
// read position (cursor) persist, so resuming continues the same items at the
// same place. Exactly one session per user is 'active' at a time; CreateSession
// ends the prior active one in the same transaction.

// CreateSession ends the user's current active session (if any) and inserts a new
// active one carrying the built queue. Single duration: min_low/min_high both
// equal durationMin for back-compat with the pre-#69 columns.
func (db *DB) CreateSession(ctx context.Context, id string, userID int64, durationMin int, themes []string, itemIDs []int64) error {
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`UPDATE sessions SET status='ended' WHERE user_id=? AND status='active'`, userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO sessions (id, user_id, min_low, min_high, duration_min, themes, item_ids, cursor, status)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active')`,
		id, userID, durationMin, durationMin, durationMin, strings.Join(themes, ","), joinInts(itemIDs)); err != nil {
		return err
	}
	return tx.Commit()
}

// CurrentSession returns the user's active session, or (nil, nil) if none.
func (db *DB) CurrentSession(ctx context.Context, userID int64) (*Session, error) {
	row := db.sql.QueryRowContext(ctx,
		`SELECT id, duration_min, themes, item_ids, cursor, status, created_at
		 FROM sessions WHERE user_id=? AND status='active' ORDER BY created_at DESC LIMIT 1`, userID)
	return scanSession(row)
}

// GetSession returns a specific session owned by the user, or (nil, nil).
func (db *DB) GetSession(ctx context.Context, userID int64, id string) (*Session, error) {
	row := db.sql.QueryRowContext(ctx,
		`SELECT id, duration_min, themes, item_ids, cursor, status, created_at
		 FROM sessions WHERE id=? AND user_id=?`, id, userID)
	return scanSession(row)
}

func scanSession(row *sql.Row) (*Session, error) {
	var s Session
	var themes, itemIDs, created string
	if err := row.Scan(&s.ID, &s.DurationMin, &themes, &itemIDs, &s.Cursor, &s.Status, &created); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	for _, t := range strings.Split(themes, ",") {
		if t = strings.TrimSpace(t); t != "" {
			s.Themes = append(s.Themes, t)
		}
	}
	s.ItemIDs = splitInts(itemIDs)
	s.CreatedAt = parseTime(created)
	return &s, nil
}

// UpdateSessionCursor advances the read position. It only touches an active
// session, so a cursor write after the session ended is a harmless no-op.
func (db *DB) UpdateSessionCursor(ctx context.Context, userID int64, id string, cursor int) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE sessions SET cursor=? WHERE id=? AND user_id=? AND status='active'`, cursor, id, userID)
	return err
}

// EndSession marks a session 'ended' (idempotent).
func (db *DB) EndSession(ctx context.Context, userID int64, id string) error {
	_, err := db.sql.ExecContext(ctx,
		`UPDATE sessions SET status='ended' WHERE id=? AND user_id=?`, id, userID)
	return err
}

// CandidatesByIDs rehydrates specific items as ranker Candidates regardless of
// their surfaced/seen state, so a stored session queue can be rebuilt on resume.
// The cadence window matches Candidates' session-build default (45 days) so the
// rehydrated scores line up with what the build produced.
func (db *DB) CandidatesByIDs(ctx context.Context, userID int64, ids []int64) ([]Candidate, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	q := `SELECT ` + candidateCols() + `
	      FROM items i
	      JOIN sources s ON s.id = i.source_id
	      WHERE s.user_id = ? AND i.id IN (` + placeholders(len(ids)) + `)`
	win := "-45 days"
	args := []any{win, win, userID}
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := db.sql.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCandidates(rows, 45)
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

func splitInts(s string) []int64 {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]int64, 0, len(parts))
	for _, p := range parts {
		if n, err := strconv.ParseInt(strings.TrimSpace(p), 10, 64); err == nil {
			out = append(out, n)
		}
	}
	return out
}
