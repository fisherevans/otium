package session

import (
	"math"
	"testing"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// cand builds a candidate with a given representation (weight) and age (days).
func cand(weight float64, ageDays float64, now time.Time) store.Candidate {
	c := store.Candidate{SourceWeight: weight}
	c.PublishedAt = now.Add(-time.Duration(ageDays*24) * time.Hour)
	return c
}

func TestIntendedDecaysWithAge(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	fresh := ItemIntendedScore(cand(1, 0, now), now)
	halfLife := ItemIntendedScore(cand(1, freshnessHalfLifeDays, now), now)
	old := ItemIntendedScore(cand(1, 180, now), now)
	if !(fresh > halfLife && halfLife > old) {
		t.Fatalf("expected fresh(%v) > halfLife(%v) > old(%v)", fresh, halfLife, old)
	}
	if math.Abs(halfLife-fresh/2) > 1e-9 {
		t.Fatalf("half-life score=%v, want ~%v", halfLife, fresh/2)
	}
}

// TestEffectiveEqualsIntended: engine v2 dropped rarity + skip penalty, so the
// effective and intended contributions coincide.
func TestEffectiveEqualsIntended(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	c := cand(2, 3, now)
	if e, i := ItemEffectiveScore(c, now), ItemIntendedScore(c, now); math.Abs(e-i) > 1e-12 {
		t.Fatalf("effective=%v should equal intended=%v", e, i)
	}
}

// TestRepresentationScalesIntended: a source weighted higher contributes a larger
// intended (share) score for the same age - representation drives the section share.
func TestRepresentationScalesIntended(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	lo := ItemIntendedScore(cand(1, 2, now), now)
	hi := ItemIntendedScore(cand(4, 2, now), now)
	if math.Abs(hi-4*lo) > 1e-9 {
		t.Fatalf("weight 4 should be 4x weight 1: hi=%v lo=%v", hi, lo)
	}
}

func TestHalfLifeResolutionHierarchy(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	global := cand(1, 7, now)
	if got := halfLifeOf(global); got != 0 {
		t.Fatalf("no override resolves to 0 (global fallback), got %v", got)
	}
	feedOnly := cand(1, 7, now)
	feedOnly.TopicHalfLifeDays = 14
	if got := halfLifeOf(feedOnly); got != 14 {
		t.Fatalf("topic half-life should apply, got %v", got)
	}
	both := cand(1, 7, now)
	both.TopicHalfLifeDays = 14
	both.SourceHalfLifeDays = 7
	if got := halfLifeOf(both); got != 7 {
		t.Fatalf("source override should win, got %v", got)
	}
}

func TestScoreBreakdownIsFreshnessOnly(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	b := ScoreBreakdownFor(cand(2, 5, now), now)
	if b.Rarity != 1 {
		t.Fatalf("engine v2 rarity should be inert (1), got %v", b.Rarity)
	}
	if math.Abs(b.EffectiveScore-b.Freshness) > 1e-12 {
		t.Fatalf("effective score should equal freshness, got %v vs %v", b.EffectiveScore, b.Freshness)
	}
}

func TestWeightForBucket(t *testing.T) {
	cases := map[string]float64{"very_low": 0.25, "low": 0.5, "normal": 1, "high": 2, "favorite": 4}
	for b, want := range cases {
		got, err := WeightForBucket(b)
		if err != nil || got != want {
			t.Fatalf("bucket %q = %v (err %v), want %v", b, got, err, want)
		}
	}
	if _, err := WeightForBucket("nope"); err == nil {
		t.Fatal("unknown bucket should error")
	}
}
