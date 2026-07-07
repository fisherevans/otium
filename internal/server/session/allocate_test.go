package session

import (
	"math/rand"
	"testing"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

func acand(sourceID int64, repr float64, ageDays float64, srcArchive, intArchive int, now time.Time) store.Candidate {
	c := store.Candidate{SourceWeight: repr,
		SourceArchiveAfterDays: srcArchive, InterestArchiveAfterDays: intArchive}
	c.SourceID = sourceID // promoted from the embedded Item
	c.PublishedAt = now.Add(-time.Duration(ageDays*24) * time.Hour)
	return c
}

func TestResolveArchiveAfter(t *testing.T) {
	now := time.Now()
	if got := resolveArchiveAfter(acand(1, 1, 0, 0, 0, now)); got != globalArchiveAfterDays {
		t.Fatalf("no override should resolve to global %d, got %d", globalArchiveAfterDays, got)
	}
	if got := resolveArchiveAfter(acand(1, 1, 0, 0, 7, now)); got != 7 {
		t.Fatalf("interest default should apply, got %d", got)
	}
	if got := resolveArchiveAfter(acand(1, 1, 0, 3, 7, now)); got != 3 {
		t.Fatalf("source override should win over interest, got %d", got)
	}
	if got := resolveArchiveAfter(acand(1, 1, 0, evergreen, 7, now)); got != evergreen {
		t.Fatalf("source evergreen override should win, got %d", got)
	}
}

func TestEligibilityArchiveCutoff(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	// 5-day window: a 3-day item is eligible, a 10-day item is not.
	if !eligible(acand(1, 1, 3, 5, 0, now), now) {
		t.Fatal("3-day item within a 5-day window should be eligible")
	}
	if eligible(acand(1, 1, 10, 5, 0, now), now) {
		t.Fatal("10-day item past a 5-day window should be ineligible")
	}
	// Evergreen: a very old item is still eligible.
	if !eligible(acand(1, 1, 400, evergreen, 0, now), now) {
		t.Fatal("evergreen source should keep an old item eligible")
	}
}

func TestAllocateFreshestWithinSource(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	pool := []store.Candidate{
		acand(1, 1, 5, 0, 0, now),
		acand(1, 1, 1, 0, 0, now), // freshest for source 1
		acand(1, 1, 3, 0, 0, now),
	}
	pool[0].ID, pool[1].ID, pool[2].ID = 10, 11, 12
	out := Allocate(pool, now, 3, rand.New(rand.NewSource(1)))
	if len(out) != 3 {
		t.Fatalf("want 3 items, got %d", len(out))
	}
	// One source, so order is pure recency: 1d, 3d, 5d -> ids 11,12,10.
	if out[0].Item.ID != 11 || out[1].Item.ID != 12 || out[2].Item.ID != 10 {
		t.Fatalf("expected newest-first 11,12,10; got %d,%d,%d", out[0].Item.ID, out[1].Item.ID, out[2].Item.ID)
	}
}

func TestAllocateExcludesArchived(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	pool := []store.Candidate{
		acand(1, 1, 2, 5, 0, now),  // eligible
		acand(1, 1, 40, 5, 0, now), // archived (past 5-day window)
	}
	pool[0].ID, pool[1].ID = 1, 2
	out := Allocate(pool, now, 10, rand.New(rand.NewSource(1)))
	if len(out) != 1 || out[0].Item.ID != 1 {
		t.Fatalf("archived item should be excluded; got %d items", len(out))
	}
}

func TestAllocateRepresentationWeighting(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	// Two sources with deep eligible pools; source 2 has 4x the representation.
	var pool []store.Candidate
	var id int64 = 1
	for i := 0; i < 400; i++ {
		a := acand(1, 1, float64(i%10), evergreen, 0, now)
		a.ID = id
		id++
		pool = append(pool, a)
	}
	for i := 0; i < 400; i++ {
		a := acand(2, 4, float64(i%10), evergreen, 0, now)
		a.ID = id
		id++
		pool = append(pool, a)
	}
	out := Allocate(pool, now, 500, rand.New(rand.NewSource(42)))
	var s1, s2 int
	for _, s := range out {
		if s.Item.SourceID == 1 {
			s1++
		} else {
			s2++
		}
	}
	// Source 2 (repr 4) should occupy roughly 4x source 1 (repr 1). Allow slack.
	ratio := float64(s2) / float64(s1)
	if ratio < 2.8 || ratio > 5.2 {
		t.Fatalf("representation weighting off: s1=%d s2=%d ratio=%.2f (want ~4)", s1, s2, ratio)
	}
}

func TestAllocateSkipsEmptySource(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	// Source 1 has 2 eligible; source 2 has huge representation but 0 eligible.
	pool := []store.Candidate{
		acand(1, 1, 1, 0, 0, now),
		acand(1, 1, 2, 0, 0, now),
		acand(2, 100, 999, 5, 0, now), // archived -> source 2 contributes nothing
	}
	pool[0].ID, pool[1].ID, pool[2].ID = 1, 2, 3
	out := Allocate(pool, now, 10, rand.New(rand.NewSource(1)))
	if len(out) != 2 {
		t.Fatalf("want 2 (source 2 empty), got %d", len(out))
	}
	for _, s := range out {
		if s.Item.SourceID == 2 {
			t.Fatal("empty source should contribute nothing despite high representation")
		}
	}
}
