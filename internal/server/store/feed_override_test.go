package store

import (
	"context"
	"testing"
	"time"
)

// TestCandidatesResolvePrimaryFeedOverrides verifies #17's plumbing: a source's
// resolved per-feed half-life/diversity come from its PRIMARY feed (lowest sort,
// then lowest id, matching PrimaryFeedsForSources), and a feedless source falls
// back to the global defaults (0/0).
func TestCandidatesResolvePrimaryFeedOverrides(t *testing.T) {
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

	// Two feeds with distinct overrides; feedB sorts before feedA, so a source in
	// both must resolve to feedB.
	feedA, err := db.CreateFeed(ctx, u.ID, "A", "a", "")
	if err != nil {
		t.Fatal(err)
	}
	feedB, err := db.CreateFeed(ctx, u.ID, "B", "b", "")
	if err != nil {
		t.Fatal(err)
	}
	setSort := func(id int64, sort int) {
		if _, err := db.sql.ExecContext(ctx, `UPDATE feeds SET sort = ? WHERE id = ?`, sort, id); err != nil {
			t.Fatal(err)
		}
	}
	setSort(feedA.ID, 10)
	setSort(feedB.ID, 1) // primary winner
	hlA, divA := 30.0, 3
	hlB, divB := 5.0, 1
	if err := db.UpdateFeed(ctx, u.ID, feedA.ID, nil, nil, nil, &hlA, &divA); err != nil {
		t.Fatal(err)
	}
	if err := db.UpdateFeed(ctx, u.ID, feedB.ID, nil, nil, nil, &hlB, &divB); err != nil {
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

	multi := mkSource("Multi", "http://multi")
	mkItem(multi, "m-1")
	if err := db.AddFeedSource(ctx, feedA.ID, multi); err != nil {
		t.Fatal(err)
	}
	if err := db.AddFeedSource(ctx, feedB.ID, multi); err != nil {
		t.Fatal(err)
	}

	loner := mkSource("Loner", "http://loner") // no feed membership
	mkItem(loner, "l-1")

	pool, err := db.Candidates(ctx, u.ID, nil, 45, 500)
	if err != nil {
		t.Fatal(err)
	}
	got := map[int64]Candidate{}
	for _, c := range pool {
		got[c.SourceID] = c
	}

	if c := got[multi]; c.FeedHalfLifeDays != hlB || c.FeedDiversity != divB {
		t.Fatalf("multi-feed source should resolve to primary feed B (hl=%v div=%d), got hl=%v div=%d",
			hlB, divB, c.FeedHalfLifeDays, c.FeedDiversity)
	}
	if c := got[loner]; c.FeedHalfLifeDays != 0 || c.FeedDiversity != 0 {
		t.Fatalf("feedless source should fall back to global defaults, got hl=%v div=%d",
			c.FeedHalfLifeDays, c.FeedDiversity)
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
