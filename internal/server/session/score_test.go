package session

import (
	"math"
	"testing"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// cand builds a candidate with a given weight, cadence, and age (days).
func cand(weight, cadence float64, ageDays float64, now time.Time) store.Candidate {
	c := store.Candidate{SourceWeight: weight, SourceCadence: cadence}
	c.PublishedAt = now.Add(-time.Duration(ageDays*24) * time.Hour)
	return c
}

func TestItemEffectiveScoreMatchesRankerSelectivityOne(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	// A source with enough shows and heavy skipping so the penalty bites.
	stat := SourceStat{Shown: 20, Skipped: 15}
	c := cand(2, 3, 5, now)
	// The mix's effective score must equal the ranker's score at selectivity 1 -
	// this is what makes the mix "match what sessions surface."
	if got, want := ItemEffectiveScore(c, now, stat), scoreOf(c, now, stat, 1); math.Abs(got-want) > 1e-12 {
		t.Fatalf("effective=%v, scoreOf(sel=1)=%v", got, want)
	}
}

func TestIntendedDropsSkipPenalty(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	c := cand(1, 3, 0, now)

	// Below the sample threshold: penalty is 1, so effective == intended.
	low := SourceStat{Shown: skipMinSample - 1, Skipped: skipMinSample - 1}
	if e, i := ItemEffectiveScore(c, now, low), ItemIntendedScore(c, now); math.Abs(e-i) > 1e-12 {
		t.Fatalf("below-sample effective=%v should equal intended=%v", e, i)
	}

	// Heavy, well-sampled skipping: effective must fall below intended.
	heavy := SourceStat{Shown: 40, Skipped: 40}
	e := ItemEffectiveScore(c, now, heavy)
	i := ItemIntendedScore(c, now)
	if !(e < i) {
		t.Fatalf("heavy-skip effective=%v should be < intended=%v", e, i)
	}
	// 100% skip over the min sample loses exactly skipPenaltyMax of the score.
	if want := i * (1 - skipPenaltyMax); math.Abs(e-want) > 1e-12 {
		t.Fatalf("effective=%v, want intended*(1-skipPenaltyMax)=%v", e, want)
	}
}

func TestIntendedDecaysWithAge(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	fresh := ItemIntendedScore(cand(1, 3, 0, now), now)
	halfLife := ItemIntendedScore(cand(1, 3, freshnessHalfLifeDays, now), now)
	old := ItemIntendedScore(cand(1, 3, 180, now), now)

	if !(fresh > halfLife && halfLife > old) {
		t.Fatalf("expected fresh(%v) > halfLife(%v) > old(%v)", fresh, halfLife, old)
	}
	// At exactly one half-life, the score should be ~half the fresh score.
	if math.Abs(halfLife-fresh/2) > 1e-9 {
		t.Fatalf("half-life score=%v, want ~%v", halfLife, fresh/2)
	}
	// An item 180 days old (>8 half-lives) has decayed to a near-zero slice.
	if old/fresh > 0.005 {
		t.Fatalf("180-day item still %.4f of fresh; expected ~0", old/fresh)
	}
}

func TestRarityLiftsInfrequentSources(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	// Same weight, same age: the rarely-posting source scores higher per item.
	frequent := ItemIntendedScore(cand(1, 5, 0, now), now) // 5/day, above rare threshold
	rare := ItemIntendedScore(cand(1, 0.1, 0, now), now)   // near-silent
	if !(rare > frequent) {
		t.Fatalf("rare source per-item=%v should exceed frequent=%v", rare, frequent)
	}
}
