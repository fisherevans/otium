package session

import (
	"math"
	"testing"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// cand builds a candidate with a given weight, rarity boost, and age (days). The
// rarity boost is what the store hands down (#110); the ranker reads it directly.
func cand(weight, rarityBoost float64, ageDays float64, now time.Time) store.Candidate {
	c := store.Candidate{SourceWeight: weight, RarityBoost: rarityBoost}
	c.PublishedAt = now.Add(-time.Duration(ageDays*24) * time.Hour)
	return c
}

func TestItemEffectiveScoreMatchesRankerSelectivityOne(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	c := cand(2, 1.5, 5, now)
	// The insights's effective score must equal the ranker's score at selectivity 1 -
	// this is what makes the insights "match what sessions surface."
	if got, want := ItemEffectiveScore(c, now), scoreOf(c, now, 1); math.Abs(got-want) > 1e-12 {
		t.Fatalf("effective=%v, scoreOf(sel=1)=%v", got, want)
	}
}

// TestEffectiveEqualsIntended locks the post-#109 invariant: with the skip penalty
// removed, the effective score is exactly the intended score - no silent behavioral
// downweight remains.
func TestEffectiveEqualsIntended(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	c := cand(1, 1, 3, now)
	if e, i := ItemEffectiveScore(c, now), ItemIntendedScore(c, now); math.Abs(e-i) > 1e-12 {
		t.Fatalf("effective=%v should equal intended=%v (no skip penalty)", e, i)
	}
}

func TestIntendedDecaysWithAge(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	fresh := ItemIntendedScore(cand(1, 1, 0, now), now)
	halfLife := ItemIntendedScore(cand(1, 1, freshnessHalfLifeDays, now), now)
	old := ItemIntendedScore(cand(1, 1, 180, now), now)

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

	c := cand(1, 1, ageDays, now) // FeedHalfLifeDays == 0 -> global
	global := ItemIntendedScore(c, now)

	fast := c
	fast.FeedHalfLifeDays = 7 // three weeks -> one week: decays faster
	if s := ItemIntendedScore(fast, now); !(s < global) {
		t.Fatalf("shorter half-life should decay faster: fast=%v global=%v", s, global)
	}

	// At exactly the feed half-life, the score is ~half the fresh score.
	freshFast := cand(1, 1, 0, now)
	freshFast.FeedHalfLifeDays = 7
	atHalf := cand(1, 1, 7, now)
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

// TestEffectiveMatchesScoreOfWithPerFeedHalfLife keeps the insights-vs-session
// invariant intact once per-feed half-life is in play: both paths must resolve
// the half-life identically (#17).
func TestEffectiveMatchesScoreOfWithPerFeedHalfLife(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	c := cand(2, 1.5, 5, now)
	c.FeedHalfLifeDays = 9 // a non-global feed override
	if got, want := ItemEffectiveScore(c, now), scoreOf(c, now, 1); math.Abs(got-want) > 1e-12 {
		t.Fatalf("per-feed half-life broke the invariant: effective=%v scoreOf(sel=1)=%v", got, want)
	}
}

// TestScoreBreakdownMultipliesToEffective is the #18 guarantee: the per-factor
// breakdown the card exposes is the *actual* ranking, not an approximation. Its
// three factors must multiply back to its own EffectiveScore, and that score must
// equal both ItemEffectiveScore and scoreOf at selectivity 1 - the same invariant
// the insights relies on. If any scorer helper changes, this fails until the breakdown
// tracks it.
func TestScoreBreakdownMultipliesToEffective(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		c    store.Candidate
	}{
		{"fresh-favorite", cand(5, 1, 0, now)},
		{"rare-source-aged", cand(1, 1.9, 30, now)},
		{"high-weight-recent", cand(2, 1.2, 5, now)},
		{"default-weight", cand(0, 1, 2, now)},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			b := ScoreBreakdownFor(tt.c, now)

			// The three factors multiply to the reported effective score.
			product := b.Weight * b.Rarity * b.Freshness
			if math.Abs(product-b.EffectiveScore) > 1e-12 {
				t.Fatalf("factors %v×%v×%v=%v != EffectiveScore=%v",
					b.Weight, b.Rarity, b.Freshness, product, b.EffectiveScore)
			}
			// And that effective score is the real ranker output at sel=1, which is
			// also what the insights shares out. Never an approximation.
			if want := ItemEffectiveScore(tt.c, now); math.Abs(b.EffectiveScore-want) > 1e-12 {
				t.Fatalf("breakdown effective=%v != ItemEffectiveScore=%v", b.EffectiveScore, want)
			}
			if want := scoreOf(tt.c, now, 1); math.Abs(b.EffectiveScore-want) > 1e-12 {
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
	global := cand(1, 1, ageDays, now)
	if got, want := halfLifeOf(global), 0.0; got != want {
		t.Fatalf("no override should resolve to 0 (global fallback), got %v", got)
	}
	wantGlobal := math.Pow(0.5, ageDays/freshnessHalfLifeDays)
	if got := ScoreBreakdownFor(global, now).Freshness; math.Abs(got-wantGlobal) > 1e-12 {
		t.Fatalf("global freshness=%v, want %v", got, wantGlobal)
	}

	// Feed only: the resolved feed half-life applies.
	feedOnly := cand(1, 1, ageDays, now)
	feedOnly.FeedHalfLifeDays = 14
	if got := halfLifeOf(feedOnly); got != 14 {
		t.Fatalf("feed-only should resolve to feed half-life 14, got %v", got)
	}

	// Source override present: it wins over the feed half-life, even a shorter one.
	both := cand(1, 1, ageDays, now)
	both.FeedHalfLifeDays = 14
	both.SourceHalfLifeDays = 7
	if got := halfLifeOf(both); got != 7 {
		t.Fatalf("source override should win over feed, got %v", got)
	}
	wantSrc := math.Pow(0.5, ageDays/7)
	if got := ScoreBreakdownFor(both, now).Freshness; math.Abs(got-wantSrc) > 1e-12 {
		t.Fatalf("source-override freshness=%v, want %v", got, wantSrc)
	}
	// The source override (7d) decays faster than its feed (14d) would have.
	feedWould := math.Pow(0.5, ageDays/14)
	if !(wantSrc < feedWould) {
		t.Fatalf("source override 7d should decay faster than feed 14d: %v vs %v", wantSrc, feedWould)
	}
}

// TestEffectiveMatchesScoreOfWithSourceHalfLife keeps the insights-vs-session
// invariant intact when a per-source override is in play: both scoring paths must
// resolve the half-life through halfLifeOf identically (#76).
func TestEffectiveMatchesScoreOfWithSourceHalfLife(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	c := cand(2, 1.5, 5, now)
	c.FeedHalfLifeDays = 30  // feed says slow
	c.SourceHalfLifeDays = 5 // source override says fast; must win in BOTH paths
	if got, want := ItemEffectiveScore(c, now), scoreOf(c, now, 1); math.Abs(got-want) > 1e-12 {
		t.Fatalf("per-source half-life broke the invariant: effective=%v scoreOf(sel=1)=%v", got, want)
	}
	// And the breakdown (the card's #18 decomposition) must agree too.
	if b := ScoreBreakdownFor(c, now); math.Abs(b.EffectiveScore-scoreOf(c, now, 1)) > 1e-12 {
		t.Fatalf("breakdown effective=%v != scoreOf(sel=1)=%v with source override", b.EffectiveScore, scoreOf(c, now, 1))
	}
}

// TestRarityLiftsInfrequentSources verifies the store-supplied relative-rarity
// boost lifts a rare source's per-item score above an otherwise-identical common
// one (#110).
func TestRarityLiftsInfrequentSources(t *testing.T) {
	now := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	// Same weight, same age: the source ranked rarer (higher boost) scores higher.
	common := ItemIntendedScore(cand(1, 1, 0, now), now) // no boost
	rare := ItemIntendedScore(cand(1, 2, 0, now), now)   // full boost
	if !(rare > common) {
		t.Fatalf("rare source per-item=%v should exceed common=%v", rare, common)
	}
}
