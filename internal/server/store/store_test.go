package store

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

// TestMigrateAddsIconIdempotent verifies the additive icon migration: it adds
// the column to a interests table that predates it, is a no-op on a table that
// already has it, and survives being run twice (the on-every-boot contract).
func TestMigrateAddsIconIdempotent(t *testing.T) {
	// Simulate a pre-icon database: a interests table without the icon column.
	sdb, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer sdb.Close()
	if _, err := sdb.Exec(`CREATE TABLE interests (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if hasColumn(t, sdb, "interests", "icon") {
		t.Fatal("precondition: interests should not have icon yet")
	}

	// Running migrate twice must be safe and leave the column present.
	for i := 0; i < 2; i++ {
		if err := migrate(sdb); err != nil {
			t.Fatalf("migrate pass %d: %v", i, err)
		}
	}
	if !hasColumn(t, sdb, "interests", "icon") {
		t.Fatal("icon column missing after migrate")
	}
}

// TestOpenAppliesSchemaAndMigration is the end-to-end path: a fresh DB gets the
// icon column from CREATE TABLE, and a interest round-trips its icon.
func TestOpenAppliesSchemaAndMigration(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if !hasColumn(t, db.sql, "interests", "icon") {
		t.Fatal("fresh schema missing icon column")
	}

	ctx := context.Background()
	u, err := db.UpsertUserByUsername(ctx, "tester", "")
	if err != nil {
		t.Fatal(err)
	}
	f, err := db.CreateInterest(ctx, u.ID, "Comedy", "comedy", "")
	if err != nil {
		t.Fatal(err)
	}
	icon := "comedy"
	if err := db.UpdateInterest(ctx, u.ID, f.ID, nil, nil, &icon, nil, nil); err != nil {
		t.Fatal(err)
	}
	interests, err := db.ListInterests(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(interests) != 1 || interests[0].Icon != "comedy" {
		t.Fatalf("icon not persisted: %+v", interests)
	}
}

// TestUpsertItemBackfillsContent locks the #58 re-fetch backfill contract: a new
// insert sets content and counts as new; re-seeing a row whose content is empty
// backfills it without counting as new; re-seeing a populated row leaves content
// untouched (no clobber).
func TestUpsertItemBackfillsContent(t *testing.T) {
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
	s, err := db.CreateSource(ctx, &Source{UserID: u.ID, Title: "S", FeedURL: "http://s", State: "followed", Weight: 1})
	if err != nil {
		t.Fatal(err)
	}
	pub := time.Now().UTC()

	content := func(ext string) string {
		var c string
		if err := db.sql.QueryRowContext(ctx,
			`SELECT content FROM items WHERE source_id = ? AND external_id = ?`, s.ID, ext).Scan(&c); err != nil {
			t.Fatal(err)
		}
		return c
	}
	upsert := func(ext, body string) bool {
		isNew, err := db.UpsertItem(ctx, &Item{
			SourceID: s.ID, ExternalID: ext, URL: "u", Title: ext, Content: body, PublishedAt: pub,
		})
		if err != nil {
			t.Fatal(err)
		}
		return isNew
	}

	// (a) genuinely new insert with a body: counted new, content set.
	if !upsert("b", "body-b") {
		t.Fatal("(a) new insert should count as new")
	}
	if got := content("b"); got != "body-b" {
		t.Fatalf("(a) content = %q, want body-b", got)
	}

	// Seed a row ingested pre-content (empty body), a genuine new insert.
	if !upsert("a", "") {
		t.Fatal("seed insert of a should count as new")
	}
	if got := content("a"); got != "" {
		t.Fatalf("seed content = %q, want empty", got)
	}

	// (b) re-seeing the empty row backfills content and is NOT counted new.
	if upsert("a", "full-body") {
		t.Fatal("(b) backfill must not count as new")
	}
	if got := content("a"); got != "full-body" {
		t.Fatalf("(b) content = %q, want full-body", got)
	}

	// (c) re-seeing a populated row leaves content unchanged (no clobber).
	if upsert("a", "different") {
		t.Fatal("(c) re-see must not count as new")
	}
	if got := content("a"); got != "full-body" {
		t.Fatalf("(c) content = %q, want unchanged full-body", got)
	}
}

// TestMigrateContentSourceBackfill locks the #98 migration: on a pre-column
// items table it adds content_source, backfills existing bodies to 'rss', leaves
// empty-body rows pending (”), and is idempotent across boots (never clobbering
// a value already set to fetched/external).
func TestMigrateContentSourceBackfill(t *testing.T) {
	sdb, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer sdb.Close()

	// Legacy items table: has content (needed by the backfill) but no content_source.
	if _, err := sdb.Exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, content TEXT NOT NULL DEFAULT '')`); err != nil {
		t.Fatal(err)
	}
	if _, err := sdb.Exec(`INSERT INTO items (id, content) VALUES (1, '<p>full</p>'), (2, '')`); err != nil {
		t.Fatal(err)
	}
	if hasColumn(t, sdb, "items", "content_source") {
		t.Fatal("precondition: items should not have content_source yet")
	}

	// Two passes: the on-every-boot contract.
	for i := 0; i < 2; i++ {
		if err := migrate(sdb); err != nil {
			t.Fatalf("migrate pass %d: %v", i, err)
		}
	}
	if !hasColumn(t, sdb, "items", "content_source") {
		t.Fatal("content_source column missing after migrate")
	}

	src := func(id int) string {
		var s string
		if err := sdb.QueryRow(`SELECT content_source FROM items WHERE id = ?`, id).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	if got := src(1); got != "rss" {
		t.Fatalf("populated body content_source = %q, want rss", got)
	}
	if got := src(2); got != "" {
		t.Fatalf("empty body content_source = %q, want '' (pending)", got)
	}

	// A value already set (e.g. an item resolved to external with no body) must
	// survive a later migrate pass - the backfill only touches rows still at ''.
	if _, err := sdb.Exec(`UPDATE items SET content_source = 'external' WHERE id = 2`); err != nil {
		t.Fatal(err)
	}
	if err := migrate(sdb); err != nil {
		t.Fatal(err)
	}
	if got := src(2); got != "external" {
		t.Fatalf("external marking clobbered by backfill: got %q", got)
	}
}

// TestContentSourceRoundTrip covers the #98 store surface end to end: ingest sets
// 'rss' for a body / pending for none, GetItem reads it back scoped to the user,
// and the two setters transition a pending item to fetched / external.
func TestContentSourceRoundTrip(t *testing.T) {
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
	s, err := db.CreateSource(ctx, &Source{UserID: u.ID, Title: "S", FeedURL: "http://s", State: "followed", Weight: 1})
	if err != nil {
		t.Fatal(err)
	}
	pub := time.Now().UTC()

	// Ingest one item with a body (rss) and one without (pending).
	if _, err := db.UpsertItem(ctx, &Item{SourceID: s.ID, ExternalID: "withbody", URL: "u1", Title: "a",
		Content: "<p>hi</p>", ContentSource: ContentSourceRSS, MediaType: "article", PublishedAt: pub}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.UpsertItem(ctx, &Item{SourceID: s.ID, ExternalID: "nobody", URL: "u2", Title: "b",
		MediaType: "article", PublishedAt: pub}); err != nil {
		t.Fatal(err)
	}

	get := func(ext string) *Item {
		var id int64
		if err := db.sql.QueryRowContext(ctx,
			`SELECT id FROM items WHERE source_id = ? AND external_id = ?`, s.ID, ext).Scan(&id); err != nil {
			t.Fatal(err)
		}
		it, err := db.GetItem(ctx, u.ID, id)
		if err != nil {
			t.Fatal(err)
		}
		if it == nil {
			t.Fatalf("GetItem(%s) = nil", ext)
		}
		return it
	}

	if got := get("withbody").ContentSource; got != ContentSourceRSS {
		t.Fatalf("rss item content_source = %q, want rss", got)
	}
	pending := get("nobody")
	if pending.ContentSource != ContentSourcePending {
		t.Fatalf("no-body item content_source = %q, want pending", pending.ContentSource)
	}

	// pending -> fetched (with a body).
	if err := db.SetItemContent(ctx, pending.ID, "<p>extracted</p>", ContentSourceFetched); err != nil {
		t.Fatal(err)
	}
	got := get("nobody")
	if got.ContentSource != ContentSourceFetched || got.Content != "<p>extracted</p>" {
		t.Fatalf("after SetItemContent: source=%q content=%q", got.ContentSource, got.Content)
	}

	// Marking external persists the once-only decision (no body).
	if err := db.SetItemContentSource(ctx, pending.ID, ContentSourceExternal); err != nil {
		t.Fatal(err)
	}
	if got := get("nobody").ContentSource; got != ContentSourceExternal {
		t.Fatalf("after SetItemContentSource: source=%q, want external", got)
	}

	// GetItem is user-scoped: another user can't read the item.
	other, err := db.UpsertUserByUsername(ctx, "other", "")
	if err != nil {
		t.Fatal(err)
	}
	if it, err := db.GetItem(ctx, other.ID, pending.ID); err != nil {
		t.Fatal(err)
	} else if it != nil {
		t.Fatal("GetItem leaked an item to a non-owner")
	}
}

func hasColumn(t *testing.T, sdb *sql.DB, table, column string) bool {
	t.Helper()
	var n int
	if err := sdb.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, table, column).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n > 0
}
