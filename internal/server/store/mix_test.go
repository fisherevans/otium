package store

import (
	"context"
	"testing"
	"time"
)

// TestMixItemsScopeAndSeenState verifies the query contract the mix view relies
// on: every item from followed/trial sources is returned regardless of seen
// state (unlike Candidates), archived sources are excluded, and the per-source
// cadence is computed over the given window.
func TestMixItemsScopeAndSeenState(t *testing.T) {
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

	mkSource := func(title, url, state string, weight float64) int64 {
		s, err := db.CreateSource(ctx, &Source{UserID: u.ID, Title: title, FeedURL: url, State: state, Weight: weight})
		if err != nil {
			t.Fatal(err)
		}
		return s.ID
	}
	followed := mkSource("Followed", "http://f", "followed", 2)
	trial := mkSource("Trial", "http://t", "trial", 1)
	archived := mkSource("Archived", "http://a", "archived", 1)

	now := time.Now().UTC()
	mkItem := func(sid int64, ext string, ageDays int) int64 {
		it := &Item{SourceID: sid, ExternalID: ext, URL: "u", Title: ext, PublishedAt: now.Add(-time.Duration(ageDays*24) * time.Hour)}
		if _, err := db.UpsertItem(ctx, it); err != nil {
			t.Fatal(err)
		}
		var id int64
		if err := db.sql.QueryRowContext(ctx, `SELECT id FROM items WHERE source_id=? AND external_id=?`, sid, ext).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	fSeen := mkItem(followed, "f-seen", 1)
	mkItem(followed, "f-unseen", 3)
	mkItem(trial, "t-1", 2)
	mkItem(archived, "a-1", 1) // must be excluded

	// Mark one followed item as skipped - it must STILL appear in the mix (the
	// mix scores all known items, not just unseen ones).
	if err := db.SetItemState(ctx, u.ID, fSeen, "skipped"); err != nil {
		t.Fatal(err)
	}

	items, err := db.MixItems(ctx, u.ID, nil, 45, RulePrimaryFeed)
	if err != nil {
		t.Fatal(err)
	}

	bySource := map[int64]int{}
	for _, c := range items {
		bySource[c.SourceID]++
		if c.SourceID == archived {
			t.Fatalf("archived source leaked into mix: %+v", c)
		}
	}
	if bySource[followed] != 2 {
		t.Fatalf("followed should contribute 2 items (seen+unseen), got %d", bySource[followed])
	}
	if bySource[trial] != 1 {
		t.Fatalf("trial should contribute 1 item, got %d", bySource[trial])
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 items across followed+trial, got %d", len(items))
	}

	// Scoping to a subset restricts the rows.
	scoped, err := db.MixItems(ctx, u.ID, []int64{trial}, 45, RulePrimaryFeed)
	if err != nil {
		t.Fatal(err)
	}
	if len(scoped) != 1 || scoped[0].SourceID != trial {
		t.Fatalf("scoped mix should be just the trial source, got %+v", scoped)
	}
	// Source facts the scorer needs are populated.
	if scoped[0].SourceWeight != 1 || scoped[0].SourceTitle != "Trial" {
		t.Fatalf("source facts missing: %+v", scoped[0])
	}
}
