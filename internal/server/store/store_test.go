package store

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

// TestMigrateAddsIconIdempotent verifies the additive icon migration: it adds
// the column to a feeds table that predates it, is a no-op on a table that
// already has it, and survives being run twice (the on-every-boot contract).
func TestMigrateAddsIconIdempotent(t *testing.T) {
	// Simulate a pre-icon database: a feeds table without the icon column.
	sdb, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer sdb.Close()
	if _, err := sdb.Exec(`CREATE TABLE feeds (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if hasColumn(t, sdb, "feeds", "icon") {
		t.Fatal("precondition: feeds should not have icon yet")
	}

	// Running migrate twice must be safe and leave the column present.
	for i := 0; i < 2; i++ {
		if err := migrate(sdb); err != nil {
			t.Fatalf("migrate pass %d: %v", i, err)
		}
	}
	if !hasColumn(t, sdb, "feeds", "icon") {
		t.Fatal("icon column missing after migrate")
	}
}

// TestOpenAppliesSchemaAndMigration is the end-to-end path: a fresh DB gets the
// icon column from CREATE TABLE, and a feed round-trips its icon.
func TestOpenAppliesSchemaAndMigration(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if !hasColumn(t, db.sql, "feeds", "icon") {
		t.Fatal("fresh schema missing icon column")
	}

	ctx := context.Background()
	u, err := db.UpsertUserByUsername(ctx, "tester", "")
	if err != nil {
		t.Fatal(err)
	}
	f, err := db.CreateFeed(ctx, u.ID, "Comedy", "comedy", "")
	if err != nil {
		t.Fatal(err)
	}
	icon := "comedy"
	if err := db.UpdateFeed(ctx, u.ID, f.ID, nil, nil, &icon, nil, nil); err != nil {
		t.Fatal(err)
	}
	feeds, err := db.ListFeeds(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(feeds) != 1 || feeds[0].Icon != "comedy" {
		t.Fatalf("icon not persisted: %+v", feeds)
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

func hasColumn(t *testing.T, sdb *sql.DB, table, column string) bool {
	t.Helper()
	var n int
	if err := sdb.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, table, column).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n > 0
}
