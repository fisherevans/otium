package store

import (
	"context"
	"testing"
	"time"
)

// mkSourceWithItems creates a user + one evergreen source with n unseen items, all
// recent (1..n days old, newest = item 0), returning the ids for rule tweaks.
func mkSourceWithItems(t *testing.T, db *DB, n int) (ctx context.Context, uid, sid int64) {
	t.Helper()
	ctx = context.Background()
	u, err := db.UpsertUserByUsername(ctx, "tester", "")
	if err != nil {
		t.Fatal(err)
	}
	s, err := db.CreateSource(ctx, &Source{UserID: u.ID, Title: "Src", FeedURL: "http://src", State: "followed", Weight: 1})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	for i := 0; i < n; i++ {
		it := &Item{SourceID: s.ID, ExternalID: itemExtID(i), URL: "u", Title: "t",
			PublishedAt: now.Add(-time.Duration(i+1) * time.Hour)} // all within ~n hours, so age-eligible
		if _, err := db.UpsertItem(ctx, it); err != nil {
			t.Fatal(err)
		}
	}
	return ctx, u.ID, s.ID
}

func itemExtID(i int) string { return "ext-" + time.Duration(i).String() + "-" + string(rune('a'+i%26)) + "-" + itoa(i) }

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}

// TestOnDeckMirrorsKeepCount is the #124 "the stat must not lie" guard: with a
// keep-latest-N count rule the on_deck figure must reflect the rule, not raw unseen.
func TestOnDeckMirrorsKeepCount(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, uid, sid := mkSourceWithItems(t, db, 10) // 10 fresh unseen items

	// Baseline: evergreen source, no count -> all 10 on deck.
	ever := -1
	if err := db.UpdateSource(ctx, uid, sid, SourcePatch{ArchiveAfterDays: &ever}); err != nil {
		t.Fatal(err)
	}
	stats, err := db.SourceStatsAll(ctx, uid)
	if err != nil {
		t.Fatal(err)
	}
	if got := stats[sid].OnDeck; got != 10 {
		t.Fatalf("evergreen no-count on_deck: want 10, got %d", got)
	}

	// Keep-latest-3 (still evergreen age): only the newest 3 are on deck.
	keep := 3
	if err := db.UpdateSource(ctx, uid, sid, SourcePatch{ArchiveKeepCount: &keep}); err != nil {
		t.Fatal(err)
	}
	stats, _ = db.SourceStatsAll(ctx, uid)
	if got := stats[sid].OnDeck; got != 3 {
		t.Fatalf("keep-3 on_deck: want 3, got %d", got)
	}
	if got := stats[sid].Unseen; got != 10 {
		t.Fatalf("unseen should still be 10 (count rule doesn't change unseen), got %d", got)
	}
}

// TestResolvedArchiveRuleRoundTrips checks the importer's rule resolver sees the
// stored count + combine and the source>interest>global age chain.
func TestResolvedArchiveRuleRoundTrips(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, uid, sid := mkSourceWithItems(t, db, 2)

	keep := 100
	comb := "or"
	days := 30
	if err := db.UpdateSource(ctx, uid, sid, SourcePatch{ArchiveAfterDays: &days, ArchiveKeepCount: &keep, ArchiveCombine: &comb}); err != nil {
		t.Fatal(err)
	}
	r, err := db.ResolvedArchiveRule(ctx, sid)
	if err != nil {
		t.Fatal(err)
	}
	if r.Days != 30 || r.KeepCount != 100 || r.Combine != "or" {
		t.Fatalf("resolved rule = %+v", r)
	}
}
