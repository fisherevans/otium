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

// TestPerFeedHalfLifeOverridesGlobal verifies a feed's half-life override
// changes the decay: a shorter half-life decays faster than the global default
// for the same age, and 0 falls back to the global (#17).
func TestPerFeedHalfLifeOverridesGlobal(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	ageDays := 7.0

	c := cand(1, 3, ageDays, now) // FeedHalfLifeDays == 0 -> global
	global := ItemIntendedScore(c, now)

	fast := c
	fast.FeedHalfLifeDays = 7 // three weeks -> one week: decays faster
	if s := ItemIntendedScore(fast, now); !(s < global) {
		t.Fatalf("shorter half-life should decay faster: fast=%v global=%v", s, global)
	}

	// At exactly the feed half-life, the score is ~half the fresh score.
	freshFast := cand(1, 3, 0, now)
	freshFast.FeedHalfLifeDays = 7
	atHalf := cand(1, 3, 7, now)
	atHalf.FeedHalfLifeDays = 7
	if got, want := ItemIntendedScore(atHalf, now), ItemIntendedScore(freshFast, now)/2; math.Abs(got-want) > 1e-9 {
		t.Fatalf("at feed half-life score=%v, want ~%v", got, want)
	}

	// Zero override matches the global half-life exactly.
	explicitGlobal := c
	explicitGlobal.FeedHalfLifeDays = freshnessHalfLifeDays
	if got, want := ItemIntendedScore(c, now), ItemIntendedScore(explicitGlobal, now); math.Abs(got-want) > 1e-12 {
		t.Fatalf("half-life 0 should equal explicit global: %v vs %v", got, want)
	}
}

// TestEffectiveMatchesScoreOfWithPerFeedHalfLife keeps the mix-vs-session
// invariant intact once per-feed half-life is in play: both paths must resolve
// the half-life identically (#17).
func TestEffectiveMatchesScoreOfWithPerFeedHalfLife(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	stat := SourceStat{Shown: 20, Skipped: 15}
	c := cand(2, 3, 5, now)
	c.FeedHalfLifeDays = 9 // a non-global feed override
	if got, want := ItemEffectiveScore(c, now, stat), scoreOf(c, now, stat, 1); math.Abs(got-want) > 1e-12 {
		t.Fatalf("per-feed half-life broke the invariant: effective=%v scoreOf(sel=1)=%v", got, want)
	}
}

// TestScoreBreakdownMultipliesToEffective is the #18 guarantee: the per-factor
// breakdown the card exposes is the *actual* ranking, not an approximation. Its
// four factors must multiply back to its own EffectiveScore, and that score must
// equal both ItemEffectiveScore and scoreOf at selectivity 1 - the same invariant
// the mix relies on. If any scorer helper changes, this fails until the breakdown
// tracks it.
func TestScoreBreakdownMultipliesToEffective(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		c    store.Candidate
		stat SourceStat
	}{
		{"fresh-favorite-no-skip", cand(5, 3, 0, now), SourceStat{}},
		{"rare-source-aged", cand(1, 0.1, 30, now), SourceStat{Shown: 3, Skipped: 2}},
		{"heavy-skip-well-sampled", cand(2, 3, 5, now), SourceStat{Shown: 20, Skipped: 15}},
		{"default-weight-under-sample", cand(0, 5, 2, now), SourceStat{Shown: skipMinSample - 1, Skipped: 4}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			b := ScoreBreakdownFor(tt.c, now, tt.stat)

			// The four factors multiply to the reported effective score.
			product := b.Weight * b.Rarity * b.Freshness * b.SkipPenalty
			if math.Abs(product-b.EffectiveScore) > 1e-12 {
				t.Fatalf("factors %v×%v×%v×%v=%v != EffectiveScore=%v",
					b.Weight, b.Rarity, b.Freshness, b.SkipPenalty, product, b.EffectiveScore)
			}
			// And that effective score is the real ranker output at sel=1, which is
			// also what the mix shares out. Never an approximation.
			if want := ItemEffectiveScore(tt.c, now, tt.stat); math.Abs(b.EffectiveScore-want) > 1e-12 {
				t.Fatalf("breakdown effective=%v != ItemEffectiveScore=%v", b.EffectiveScore, want)
			}
			if want := scoreOf(tt.c, now, tt.stat, 1); math.Abs(b.EffectiveScore-want) > 1e-12 {
				t.Fatalf("breakdown effective=%v != scoreOf(sel=1)=%v", b.EffectiveScore, want)
			}
		})
	}
}

// TestSourceHalfLifeResolutionHierarchy verifies the #76 precedence
// source override > feed (resolved) > global. A source override wins over the
// feed half-life; with no source override the feed half-life applies; with
// neither, the global default is used.
func TestSourceHalfLifeResolutionHierarchy(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	ageDays := 7.0

	// Global: no source, no feed override -> decays at freshnessHalfLifeDays.
	global := cand(1, 3, ageDays, now)
	if got, want := halfLifeOf(global), 0.0; got != want {
		t.Fatalf("no override should resolve to 0 (global fallback), got %v", got)
	}
	wantGlobal := math.Pow(0.5, ageDays/freshnessHalfLifeDays)
	if got := ScoreBreakdownFor(global, now, SourceStat{}).Freshness; math.Abs(got-wantGlobal) > 1e-12 {
		t.Fatalf("global freshness=%v, want %v", got, wantGlobal)
	}

	// Feed only: the resolved feed half-life applies.
	feedOnly := cand(1, 3, ageDays, now)
	feedOnly.FeedHalfLifeDays = 14
	if got := halfLifeOf(feedOnly); got != 14 {
		t.Fatalf("feed-only should resolve to feed half-life 14, got %v", got)
	}

	// Source override present: it wins over the feed half-life, even a shorter one.
	both := cand(1, 3, ageDays, now)
	both.FeedHalfLifeDays = 14
	both.SourceHalfLifeDays = 7
	if got := halfLifeOf(both); got != 7 {
		t.Fatalf("source override should win over feed, got %v", got)
	}
	wantSrc := math.Pow(0.5, ageDays/7)
	if got := ScoreBreakdownFor(both, now, SourceStat{}).Freshness; math.Abs(got-wantSrc) > 1e-12 {
		t.Fatalf("source-override freshness=%v, want %v", got, wantSrc)
	}
	// The source override (7d) decays faster than its feed (14d) would have.
	feedWould := math.Pow(0.5, ageDays/14)
	if !(wantSrc < feedWould) {
		t.Fatalf("source override 7d should decay faster than feed 14d: %v vs %v", wantSrc, feedWould)
	}
}

// TestEffectiveMatchesScoreOfWithSourceHalfLife keeps the mix-vs-session
// invariant intact when a per-source override is in play: both scoring paths must
// resolve the half-life through halfLifeOf identically (#76).
func TestEffectiveMatchesScoreOfWithSourceHalfLife(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	stat := SourceStat{Shown: 20, Skipped: 15}
	c := cand(2, 3, 5, now)
	c.FeedHalfLifeDays = 30  // feed says slow
	c.SourceHalfLifeDays = 5 // source override says fast; must win in BOTH paths
	if got, want := ItemEffectiveScore(c, now, stat), scoreOf(c, now, stat, 1); math.Abs(got-want) > 1e-12 {
		t.Fatalf("per-source half-life broke the invariant: effective=%v scoreOf(sel=1)=%v", got, want)
	}
	// And the breakdown (the card's #18 decomposition) must agree too.
	if b := ScoreBreakdownFor(c, now, stat); math.Abs(b.EffectiveScore-scoreOf(c, now, stat, 1)) > 1e-12 {
		t.Fatalf("breakdown effective=%v != scoreOf(sel=1)=%v with source override", b.EffectiveScore, scoreOf(c, now, stat, 1))
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
