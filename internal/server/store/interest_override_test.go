package store

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

// TestCandidatesResolveOneFeedOverrides verifies #86's plumbing: a source's
// resolved per-topic half-life/diversity come from its ONE topic (sources.topic_id),
// and a topicless source falls back to the global defaults (0/0).
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

	topic, err := db.CreateTopic(ctx, u.ID, "A", "a", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	hl := 5.0
	if err := db.UpdateTopic(ctx, u.ID, topic.ID, nil, nil, nil, &hl, nil); err != nil {
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
	if err := db.AssignSourceTopic(ctx, member, topic.ID); err != nil {
		t.Fatal(err)
	}

	loner := mkSource("Loner", "http://loner") // no topic
	mkItem(loner, "l-1")

	pool, err := db.Candidates(ctx, u.ID, nil, 45, 500)
	if err != nil {
		t.Fatal(err)
	}
	got := map[int64]Candidate{}
	for _, c := range pool {
		got[c.SourceID] = c
	}

	if c := got[member]; c.TopicHalfLifeDays != hl {
		t.Fatalf("topic member should resolve its one topic's half-life (hl=%v), got hl=%v", hl, c.TopicHalfLifeDays)
	}
	if c := got[loner]; c.TopicHalfLifeDays != 0 {
		t.Fatalf("topicless source should fall back to the global half-life default, got hl=%v", c.TopicHalfLifeDays)
	}
}

// TestMigratePopulatesSourceTopicID is the load-bearing #86 migration test: on a
// database that still carries the legacy feed_sources membership, migrate()
// back-populates sources.topic_id from it, leaves feed_sources intact, and is
// idempotent on re-run. This mirrors the real data (every source in exactly one
// topic) the cutover relies on.
func TestMigratePopulatesSourceTopicID(t *testing.T) {
	// Build a "pre-#86" database by hand: schema.sql already has topic_id, so drop
	// it back out by creating the tables without it and seeding legacy memberships.
	sdb, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer sdb.Close()

	// Minimal legacy shape: users, topics, sources (NO topic_id), feed_sources.
	stmts := []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE)`,
		`CREATE TABLE topics (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL)`,
		`CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, feed_url TEXT NOT NULL)`,
		`CREATE TABLE feed_sources (feed_id INTEGER NOT NULL, source_id INTEGER NOT NULL, PRIMARY KEY (feed_id, source_id))`,
		`INSERT INTO users (id, username) VALUES (1, 'tester')`,
		`INSERT INTO topics (id, user_id, name, slug) VALUES (10, 1, 'News', 'news'), (11, 1, 'Comedy', 'comedy')`,
		`INSERT INTO sources (id, user_id, title, feed_url) VALUES (100, 1, 'A', 'http://a'), (101, 1, 'B', 'http://b'), (102, 1, 'C', 'http://c')`,
		// A and B each in exactly one topic; C in none (topicless).
		`INSERT INTO feed_sources (feed_id, source_id) VALUES (10, 100), (11, 101)`,
	}
	for _, s := range stmts {
		if _, err := sdb.Exec(s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	if hasColumn(t, sdb, "sources", "topic_id") {
		t.Fatal("precondition: legacy sources should not have topic_id yet")
	}

	// Run migrate twice (the on-every-boot contract).
	for i := 0; i < 2; i++ {
		if err := migrate(sdb); err != nil {
			t.Fatalf("migrate pass %d: %v", i, err)
		}
	}

	if !hasColumn(t, sdb, "sources", "topic_id") {
		t.Fatal("topic_id column missing after migrate")
	}

	topicOf := func(sourceID int64) (int64, bool) {
		var fid sql.NullInt64
		if err := sdb.QueryRow(`SELECT topic_id FROM sources WHERE id = ?`, sourceID).Scan(&fid); err != nil {
			t.Fatal(err)
		}
		return fid.Int64, fid.Valid
	}

	if fid, ok := topicOf(100); !ok || fid != 10 {
		t.Fatalf("source 100 should populate topic_id=10, got %d (set=%v)", fid, ok)
	}
	if fid, ok := topicOf(101); !ok || fid != 11 {
		t.Fatalf("source 101 should populate topic_id=11, got %d (set=%v)", fid, ok)
	}
	// #130 strict tree: a source with no feed_sources membership is no longer left
	// NULL - enforceTree routes it to the user's Uncategorized topic (no orphans).
	if fid, ok := topicOf(102); !ok {
		t.Fatal("topicless source 102 should be routed to Uncategorized, got NULL")
	} else {
		var slug string
		if err := sdb.QueryRow(`SELECT slug FROM topics WHERE id = ?`, fid).Scan(&slug); err != nil {
			t.Fatal(err)
		}
		if slug != "uncategorized" {
			t.Fatalf("source 102 should be in 'uncategorized', got %q", slug)
		}
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

// TestOpenMigratesLegacyFileTopicID exercises the REAL production upgrade path
// (#86): a legacy on-disk DB whose `sources` table predates topic_id, opened by
// Open() so schema.sql runs first (must NOT trip on topic_id) and then migrate()
// adds + back-populates the column. This is the guard against re-adding the
// idx_sources_topic index to schema.sql, which would fail here before migrate runs.
func TestOpenMigratesLegacyFileTopicID(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/legacy.db"

	// Seed a legacy file: sources WITHOUT topic_id, plus feed_sources memberships.
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	stmts := []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE)`,
		`CREATE TABLE topics (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, color TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'rss', title TEXT NOT NULL, feed_url TEXT NOT NULL, homepage_url TEXT NOT NULL DEFAULT '', icon_url TEXT NOT NULL DEFAULT '', weight REAL NOT NULL DEFAULT 1.0, state TEXT NOT NULL DEFAULT 'followed', trial_until TEXT, per_session_cap INTEGER NOT NULL DEFAULT 2, added_at TEXT NOT NULL DEFAULT (datetime('now')), last_fetch_at TEXT, fetch_error TEXT NOT NULL DEFAULT '', UNIQUE (user_id, feed_url))`,
		`CREATE TABLE feed_sources (feed_id INTEGER NOT NULL, source_id INTEGER NOT NULL, PRIMARY KEY (feed_id, source_id))`,
		`INSERT INTO users (id, username) VALUES (1, 'tester')`,
		`INSERT INTO topics (id, user_id, name, slug) VALUES (10, 1, 'News', 'news')`,
		`INSERT INTO sources (id, user_id, title, feed_url) VALUES (100, 1, 'A', 'http://a'), (101, 1, 'B', 'http://b')`,
		`INSERT INTO feed_sources (feed_id, source_id) VALUES (10, 100)`, // A -> news; B topicless
	}
	for _, s := range stmts {
		if _, err := legacy.Exec(s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	legacy.Close()

	// The real path: schema.sql (must not fail on the missing topic_id) then migrate.
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open legacy file: %v", err)
	}
	defer db.Close()

	if !hasColumn(t, db.sql, "sources", "topic_id") {
		t.Fatal("topic_id missing after Open")
	}
	// Source A resolves its one topic; the candidate half-life plumbing works.
	srcs, err := db.ListSources(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	got := map[int64]string{}
	for _, s := range srcs {
		got[s.ID] = s.TopicSlug
	}
	if got[100] != "news" {
		t.Fatalf("source 100 should back-populate topic 'news', got %q", got[100])
	}
	// #130 strict tree: the membership-less source is routed to Uncategorized.
	if got[101] != "uncategorized" {
		t.Fatalf("topicless source 101 should be routed to 'uncategorized', got %q", got[101])
	}
}

// TestMigrateDropsDiversity verifies the half_life_days override survives while the
// retired diversity column is dropped (#120), including the legacy path where an
// existing DB still carries the column - and that re-running migrate is a no-op.
func TestMigrateDropsDiversity(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if !hasColumn(t, db.sql, "topics", "half_life_days") {
		t.Fatal("fresh schema missing half_life_days")
	}
	if hasColumn(t, db.sql, "topics", "diversity") {
		t.Fatal("fresh schema should no longer carry diversity")
	}
	// Simulate a legacy DB that still has the column, then migrate must drop it.
	if _, err := db.sql.Exec(`ALTER TABLE topics ADD COLUMN diversity INTEGER NOT NULL DEFAULT 0`); err != nil {
		t.Fatal(err)
	}
	if err := migrate(db.sql); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if hasColumn(t, db.sql, "topics", "diversity") {
		t.Fatal("migrate should have dropped diversity")
	}
	// Rerunning migrate on the already-migrated DB is a no-op, not an error.
	if err := migrate(db.sql); err != nil {
		t.Fatalf("re-migrate: %v", err)
	}
}
