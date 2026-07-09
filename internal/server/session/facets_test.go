package session

import (
	"math/rand"
	"testing"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

func fcand(id int64, ageDays float64, durationSec int, now time.Time) store.Candidate {
	c := store.Candidate{}
	c.ID = id
	c.SourceID = 1
	c.PublishedAt = now.Add(-time.Duration(ageDays*24) * time.Hour)
	c.DurationSec = durationSec
	return c
}

func TestScoringDefaultIsByteIdentical(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	// A default (blank / "newest") config must not divert from the pure-recency path.
	if !parseScoring("").isDefault() {
		t.Fatal("blank config should be default")
	}
	if !parseScoring(`{"direction":"newest"}`).isDefault() {
		t.Fatal("newest with no facets should be default")
	}
	if parseScoring(`{"direction":"oldest"}`).isDefault() {
		t.Fatal("oldest should not be default")
	}
	if parseScoring(`{"direction":"newest","length":{"prefer":"longer"}}`).isDefault() {
		t.Fatal("a length facet makes it non-default")
	}
	_ = now
}

func TestOrderSourceOldestReverses(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	cs := []store.Candidate{
		fcand(1, 1, 0, now),  // newest
		fcand(2, 5, 0, now),  // middle
		fcand(3, 10, 0, now), // oldest
	}
	orderSource(cs, ScoringConfig{Direction: "oldest"}, 7, now)
	if cs[0].ID != 3 || cs[1].ID != 2 || cs[2].ID != 1 {
		t.Fatalf("oldest-first order wrong: %d,%d,%d", cs[0].ID, cs[1].ID, cs[2].ID)
	}
}

func TestOrderSourceNewestMatchesRecency(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	cs := []store.Candidate{
		fcand(1, 10, 0, now),
		fcand(2, 1, 0, now),
		fcand(3, 5, 0, now),
	}
	orderSource(cs, ScoringConfig{Direction: "newest"}, 7, now)
	if cs[0].ID != 2 || cs[1].ID != 3 || cs[2].ID != 1 {
		t.Fatalf("newest-first order wrong: %d,%d,%d", cs[0].ID, cs[1].ID, cs[2].ID)
	}
}

func TestOrderSourceRandomDeterministic(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	mk := func() []store.Candidate {
		return []store.Candidate{fcand(1, 1, 0, now), fcand(2, 2, 0, now), fcand(3, 3, 0, now), fcand(4, 4, 0, now)}
	}
	a, b := mk(), mk()
	orderSource(a, ScoringConfig{Direction: "random"}, 42, now)
	orderSource(b, ScoringConfig{Direction: "random"}, 42, now)
	for i := range a {
		if a[i].ID != b[i].ID {
			t.Fatalf("same seed must give same order: %d vs %d at %d", a[i].ID, b[i].ID, i)
		}
	}
}

func TestLengthScoreFlooredNotOmitted(t *testing.T) {
	// A zero-duration item (un-enriched YouTube) is down-weighted for "longer" but
	// never zeroed - it must still be able to appear.
	if s := lengthScore(0, "longer"); s <= 0 || s > lengthFloor+1e-9 {
		t.Fatalf("zero-duration longer score should be the floor, got %v", s)
	}
	if lengthScore(3600, "longer") <= lengthScore(60, "longer") {
		t.Fatal("longer preference should score an hour above a minute")
	}
	if lengthScore(60, "shorter") <= lengthScore(3600, "shorter") {
		t.Fatal("shorter preference should score a minute above an hour")
	}
}

func TestAllocateScoringOrdersWithinSource(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	// One source, oldest-direction config: the session should lead with the oldest.
	var pool []store.Candidate
	for i := 0; i < 3; i++ {
		c := fcand(int64(i+1), float64(1+i*3), 0, now)
		c.SourceWeight = 1
		c.SourceArchiveAfterDays = evergreen
		c.ScoringConfig = `{"direction":"oldest"}`
		pool = append(pool, c)
	}
	out := Allocate(pool, now, 3, rand.New(rand.NewSource(1)))
	if len(out) != 3 || out[0].Item.ID != 3 {
		t.Fatalf("oldest-direction should lead with the oldest item; got first id %d (n=%d)", out[0].Item.ID, len(out))
	}
}
