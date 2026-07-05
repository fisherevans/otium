package store

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

// TestCandidatesResolveOneFeedOverrides verifies #86's plumbing: a source's
// resolved per-feed half-life/diversity come from its ONE feed (sources.feed_id),
// and a feedless source falls back to the global defaults (0/0).
func TestCandidatesResolveOneFeedOverrides(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()

	u, err := db.UpsertUserByUsername(ctx, "tester", "")
	if err != nil {
		t.Fatal(err)
	}

	feed, err := db.CreateFeed(ctx, u.ID, "A", "a", "")
	if err != nil {
		t.Fatal(err)
	}
	hl, div := 5.0, 1
	if err := db.UpdateFeed(ctx, u.ID, feed.ID, nil, nil, nil, &hl, &div); err != nil {
		t.Fatal(err)
	}

	mkSource := func(title, url string) int64 {
		s, err := db.CreateSource(ctx, &Source{UserID: u.ID, Title: title, FeedURL: url, State: "followed", Weight: 1})
		if err != nil {
			t.Fatal(err)
		}
		return s.ID
	}
	now := time.Now().UTC()
	mkItem := func(sid int64, ext string) {
		it := &Item{SourceID: sid, ExternalID: ext, URL: "u", Title: ext, PublishedAt: now.Add(-24 * time.Hour)}
		if _, err := db.UpsertItem(ctx, it); err != nil {
			t.Fatal(err)
		}
	}

	member := mkSource("Member", "http://member")
	mkItem(member, "m-1")
	if err := db.AssignSourceFeed(ctx, member, feed.ID); err != nil {
		t.Fatal(err)
	}

	loner := mkSource("Loner", "http://loner") // no feed
	mkItem(loner, "l-1")

	pool, err := db.Candidates(ctx, u.ID, nil, 45, 500)
	if err != nil {
		t.Fatal(err)
	}
	got := map[int64]Candidate{}
	for _, c := range pool {
		got[c.SourceID] = c
	}

	if c := got[member]; c.FeedHalfLifeDays != hl || c.FeedDiversity != div {
		t.Fatalf("feed member should resolve its one feed (hl=%v div=%d), got hl=%v div=%d",
			hl, div, c.FeedHalfLifeDays, c.FeedDiversity)
	}
	if c := got[loner]; c.FeedHalfLifeDays != 0 || c.FeedDiversity != 0 {
		t.Fatalf("feedless source should fall back to global defaults, got hl=%v div=%d",
			c.FeedHalfLifeDays, c.FeedDiversity)
	}
}

// TestMigratePopulatesSourceFeedID is the load-bearing #86 migration test: on a
// database that still carries the legacy feed_sources membership, migrate()
// back-populates sources.feed_id from it, leaves feed_sources intact, and is
// idempotent on re-run. This mirrors the real data (every source in exactly one
// feed) the cutover relies on.
func TestMigratePopulatesSourceFeedID(t *testing.T) {
	// Build a "pre-#86" database by hand: schema.sql already has feed_id, so drop
	// it back out by creating the tables without it and seeding legacy memberships.
	sdb, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer sdb.Close()

	// Minimal legacy shape: users, feeds, sources (NO feed_id), feed_sources.
	stmts := []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE)`,
		`CREATE TABLE feeds (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL)`,
		`CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, feed_url TEXT NOT NULL)`,
		`CREATE TABLE feed_sources (feed_id INTEGER NOT NULL, source_id INTEGER NOT NULL, PRIMARY KEY (feed_id, source_id))`,
		`INSERT INTO users (id, username) VALUES (1, 'tester')`,
		`INSERT INTO feeds (id, user_id, name, slug) VALUES (10, 1, 'News', 'news'), (11, 1, 'Comedy', 'comedy')`,
		`INSERT INTO sources (id, user_id, title, feed_url) VALUES (100, 1, 'A', 'http://a'), (101, 1, 'B', 'http://b'), (102, 1, 'C', 'http://c')`,
		// A and B each in exactly one feed; C in none (feedless).
		`INSERT INTO feed_sources (feed_id, source_id) VALUES (10, 100), (11, 101)`,
	}
	for _, s := range stmts {
		if _, err := sdb.Exec(s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	if hasColumn(t, sdb, "sources", "feed_id") {
		t.Fatal("precondition: legacy sources should not have feed_id yet")
	}

	// Run migrate twice (the on-every-boot contract).
	for i := 0; i < 2; i++ {
		if err := migrate(sdb); err != nil {
			t.Fatalf("migrate pass %d: %v", i, err)
		}
	}

	if !hasColumn(t, sdb, "sources", "feed_id") {
		t.Fatal("feed_id column missing after migrate")
	}

	feedOf := func(sourceID int64) (int64, bool) {
		var fid sql.NullInt64
		if err := sdb.QueryRow(`SELECT feed_id FROM sources WHERE id = ?`, sourceID).Scan(&fid); err != nil {
			t.Fatal(err)
		}
		return fid.Int64, fid.Valid
	}

	if fid, ok := feedOf(100); !ok || fid != 10 {
		t.Fatalf("source 100 should populate feed_id=10, got %d (set=%v)", fid, ok)
	}
	if fid, ok := feedOf(101); !ok || fid != 11 {
		t.Fatalf("source 101 should populate feed_id=11, got %d (set=%v)", fid, ok)
	}
	if _, ok := feedOf(102); ok {
		t.Fatal("feedless source 102 should stay NULL")
	}

	// feed_sources is left intact for rollback safety.
	var legacy int
	if err := sdb.QueryRow(`SELECT COUNT(*) FROM feed_sources`).Scan(&legacy); err != nil {
		t.Fatal(err)
	}
	if legacy != 2 {
		t.Fatalf("feed_sources must be left intact (2 rows), got %d", legacy)
	}
}

// TestOpenMigratesLegacyFileFeedID exercises the REAL production upgrade path
// (#86): a legacy on-disk DB whose `sources` table predates feed_id, opened by
// Open() so schema.sql runs first (must NOT trip on feed_id) and then migrate()
// adds + back-populates the column. This is the guard against re-adding the
// idx_sources_feed index to schema.sql, which would fail here before migrate runs.
func TestOpenMigratesLegacyFileFeedID(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/legacy.db"

	// Seed a legacy file: sources WITHOUT feed_id, plus feed_sources memberships.
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	stmts := []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE)`,
		`CREATE TABLE feeds (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, color TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'rss', title TEXT NOT NULL, feed_url TEXT NOT NULL, homepage_url TEXT NOT NULL DEFAULT '', icon_url TEXT NOT NULL DEFAULT '', weight REAL NOT NULL DEFAULT 1.0, state TEXT NOT NULL DEFAULT 'followed', trial_until TEXT, per_session_cap INTEGER NOT NULL DEFAULT 2, added_at TEXT NOT NULL DEFAULT (datetime('now')), last_fetch_at TEXT, fetch_error TEXT NOT NULL DEFAULT '', UNIQUE (user_id, feed_url))`,
		`CREATE TABLE feed_sources (feed_id INTEGER NOT NULL, source_id INTEGER NOT NULL, PRIMARY KEY (feed_id, source_id))`,
		`INSERT INTO users (id, username) VALUES (1, 'tester')`,
		`INSERT INTO feeds (id, user_id, name, slug) VALUES (10, 1, 'News', 'news')`,
		`INSERT INTO sources (id, user_id, title, feed_url) VALUES (100, 1, 'A', 'http://a'), (101, 1, 'B', 'http://b')`,
		`INSERT INTO feed_sources (feed_id, source_id) VALUES (10, 100)`, // A -> news; B feedless
	}
	for _, s := range stmts {
		if _, err := legacy.Exec(s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	legacy.Close()

	// The real path: schema.sql (must not fail on the missing feed_id) then migrate.
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open legacy file: %v", err)
	}
	defer db.Close()

	if !hasColumn(t, db.sql, "sources", "feed_id") {
		t.Fatal("feed_id missing after Open")
	}
	// Source A resolves its one feed; the candidate half-life plumbing works.
	srcs, err := db.ListSources(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	got := map[int64]string{}
	for _, s := range srcs {
		got[s.ID] = s.FeedSlug
	}
	if got[100] != "news" {
		t.Fatalf("source 100 should back-populate feed 'news', got %q", got[100])
	}
	if got[101] != "" {
		t.Fatalf("feedless source 101 should have no feed, got %q", got[101])
	}
}

// TestMigrateAddsFeedOverridesIdempotent verifies the additive half_life_days /
// diversity columns migrate onto a pre-existing feeds table and survive reruns.
func TestMigrateAddsFeedOverridesIdempotent(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if !hasColumn(t, db.sql, "feeds", "half_life_days") {
		t.Fatal("fresh schema missing half_life_days")
	}
	if !hasColumn(t, db.sql, "feeds", "diversity") {
		t.Fatal("fresh schema missing diversity")
	}
	// Rerunning migrate on the already-migrated DB is a no-op, not an error.
	if err := migrate(db.sql); err != nil {
		t.Fatalf("re-migrate: %v", err)
	}
}
