// Package session builds a time-boxed, weighted, explainable consumption
// session from a pool of candidate items. This is otium's core: not an infinite
// ranked feed, but "given these sources, their weights, and how much time you
// want, here is a finite set worth your attention, and here is exactly why each
// item is in it."
//
// The scoring is deterministic - no black box. Every selected item carries a
// human-readable Reason derived from the same factors the ranker used:
// score = weight × rarity × freshness. Rarity is population-relative (the store
// ranks a source's cadence against the user's other sources, #110); there is no
// silent behavioral downweight - skipping drives an explicit, user-approved
// recommendation, not an automatic score cut (#109).
package session

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// Tunables. freshnessHalfLifeDays and the per-source cap are the global
// defaults; a feed can override both per-feed (Candidate.FeedHalfLifeDays /
// FeedDiversity, #17). Rarity has no tunable here anymore: it's a relative rank
// the store computes across the user's sources (store.RarityBoost, #110).
const (
	freshnessHalfLifeDays = 21.0 // default: an item's freshness score halves every 3 weeks

	// Prediction: how many items the user will actually get through. Content
	// duration is only half of it - the user skims/skips, so effective time per
	// item is a fraction of the content length.
	skimFactor       = 0.4   // user typically spends ~40% of an item's length
	articleEffSec    = 40.0  // effective time for a duration-less item (an article)
	defaultAvgEffSec = 120.0 // fallback when we know nothing about the insights
)

// SourceStat is the per-source behavioral + content signal the ranker folds in.
// AvgContentSec (empirical time-per-item) drives session-size prediction. Shown/
// Skipped are carried for the insights view and the future skip recommendation (#19);
// they no longer touch scoring - a skip is a signal the user acts on, not a
// silent downweight (#109).
type SourceStat struct {
	AvgContentSec float64 // avg known content duration over recent items (0 = none/article)
	Shown         int
	Skipped       int
}

// defaultDurationSec estimates how long an item takes to consume when the feed
// didn't tell us (RSS rarely carries duration). Rough, tunable.
var defaultDurationSec = map[string]int{
	"short":   60,
	"long":    600,
	"article": 240,
	"audio":   1800,
	"live":    1200,
	"unknown": 180,
}

// Request is a session ask. MinLow/MinHigh are the user's wall-clock time budget
// (minutes) - they are NOT used to size the item set. The session is a ranked
// queue the client paces against elapsed time; QueueSize bounds how many items
// to stage up front (the client refills as it goes).
type Request struct {
	MinLow    int // lower bound, minutes (client-side pacing budget)
	MinHigh   int // upper bound, minutes (client-side pacing budget)
	QueueSize int // max items to stage (0 -> default)
}

const defaultQueueSize = 30

// Selected is one item chosen for the session, with the ranker's rationale.
// Feed is the item's primary feed identity, filled by the handler after the
// ranker runs (the ranker itself is feed-agnostic); nil for a feedless source.
type Selected struct {
	Item        store.Item     `json:"item"`
	SourceTitle string         `json:"source_title"`
	Feed        *store.FeedRef `json:"feed,omitempty"`
	Score       float64        `json:"score"`
	EstDuration int            `json:"est_duration_sec"`
	Reason      string         `json:"reason"`
	Breakdown   ScoreBreakdown `json:"breakdown"`
}

// ScoreBreakdown is the per-factor decomposition of an item's score (#18): the
// individual multiplicative contributions the ranker actually used, so the
// one-line Reason becomes legible as math. EffectiveScore is the product of the
// three factors and equals ItemEffectiveScore - the invariant test locks that, so
// this is never an approximation of the ranking, it *is* the ranking.
//
// Selectivity is deliberately absent: it's a per-session budget adjustment (an
// exponent on weight×rarity that sharpens scarce sessions), not a property of the
// item. The breakdown reports the item's standalone effective score - the same
// value the insights view shares out - so "why this item" reads the same regardless of
// how big a session it landed in.
type ScoreBreakdown struct {
	Weight         float64 `json:"weight"`          // source weight multiplier (0.25..5, default 1)
	Rarity         float64 `json:"rarity"`          // relative-rarity boost (1 = as common as your feed gets, up to 1+rareBoostMax for the rarest)
	Freshness      float64 `json:"freshness"`       // age decay (1 = brand new, → 0 as it ages past the half-life)
	EffectiveScore float64 `json:"effective_score"` // weight × rarity × freshness
	// Human-legible context for the plain-language lines - not factors, just the
	// raw inputs behind them.
	CadencePerDay float64 `json:"cadence_per_day"` // source's posts/day over the window (its position among your sources drives Rarity)
	AgeDays       float64 `json:"age_days"`        // item age in days at build time (drives Freshness)
}

// ScoreBreakdownFor decomposes an item's effective score into the exact factors
// the ranker used. It reuses the same scorer helpers as scoreOf /
// ItemEffectiveScore - it does not re-derive the formula - so EffectiveScore is
// guaranteed to equal ItemEffectiveScore(c, now). Keep it that way: the value
// here is deterministic auditability, and an approximation would defeat the point.
func ScoreBreakdownFor(c store.Candidate, now time.Time) ScoreBreakdown {
	w := sourceWeight(c)
	rarity := rarityOf(c)
	fresh := freshness(c.PublishedAt, now, halfLifeOf(c))
	ageDays := now.Sub(c.PublishedAt).Hours() / 24
	if ageDays < 0 {
		ageDays = 0
	}
	return ScoreBreakdown{
		Weight:         w,
		Rarity:         rarity,
		Freshness:      fresh,
		EffectiveScore: w * rarity * fresh,
		CadencePerDay:  c.SourceCadence,
		AgeDays:        ageDays,
	}
}

// Result is a built session.
type Result struct {
	Items          []Selected `json:"items"`
	TotalSeconds   int        `json:"total_seconds"`
	TargetLow      int        `json:"target_low_min"`
	TargetHigh     int        `json:"target_high_min"`
	PoolSize       int        `json:"pool_size"`
	PredictedItems int        `json:"predicted_items"` // how many we expect the user to get through
}

type scored struct {
	c        store.Candidate
	score    float64
	dur      int
	reason   string
	sourceID int64
	taken    bool
}

// Build ranks the candidate pool and stages a queue of the top items, capping
// per-source volume and avoiding back-to-back items from the same source. It is
// count-bounded, NOT duration-bounded: the client consumes this queue paced by
// the user's elapsed wall-clock time (a skimmed article costs seconds, a watched
// video costs minutes - only the user's clock knows), refilling as it goes. stats
// carries the per-source content-duration signal used only for session-size
// prediction; the score itself is behavior-free.
func Build(req Request, pool []store.Candidate, now time.Time, stats map[int64]SourceStat) Result {
	// Predict how many items the user will actually get through this session, from
	// their time budget and the insights's empirical time-per-item. Scarcer sessions
	// sharpen selectivity so the few slots they'll see go to the best items.
	predicted := predictItems(req, pool, stats)
	sel := selectivity(predicted)

	k := req.QueueSize
	if k <= 0 {
		k = clampInt(predicted*3, 20, defaultQueueSize*2)
	}

	ranked := make([]scored, 0, len(pool))
	for _, c := range pool {
		ranked = append(ranked, scored{
			c:        c,
			score:    scoreOf(c, now, sel),
			dur:      estDuration(c),
			reason:   reasonOf(c, now),
			sourceID: c.SourceID,
		})
	}
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })

	perSourceUsed := map[int64]int{}
	out := make([]Selected, 0, k) // never nil: an empty session must serialize as [] not null
	total := 0
	lastSource := int64(-1)

	// Two passes. Pass 1 enforces the per-source cap and no-back-to-back
	// diversity; pass 2 relaxes both slightly to fill the queue when the pool is
	// thin, rather than returning a short list.
	for pass := 0; pass < 2 && len(out) < k; pass++ {
		for i := range ranked {
			if len(out) >= k {
				break
			}
			r := &ranked[i]
			if r.taken {
				continue
			}
			// Per-session cap: the item's feed diversity overrides the source's own
			// cap when set (#17). Lower cap = each source contributes fewer items, so
			// the session spreads across more of the feed's sources.
			cap := r.c.PerSessionCap
			if cap <= 0 {
				cap = 2
			}
			if r.c.FeedDiversity > 0 {
				cap = r.c.FeedDiversity
			}
			if pass == 0 {
				if perSourceUsed[r.sourceID] >= cap {
					continue
				}
				if r.sourceID == lastSource {
					continue // diversity: no back-to-back on the first pass
				}
			} else if perSourceUsed[r.sourceID] >= cap+2 {
				continue // pass 2 relaxes the cap a little to fill the queue
			}
			out = append(out, Selected{
				Item:        r.c.Item,
				SourceTitle: r.c.SourceTitle,
				Score:       round2(r.score),
				EstDuration: r.dur,
				Reason:      r.reason,
				Breakdown:   ScoreBreakdownFor(r.c, now),
			})
			total += r.dur
			perSourceUsed[r.sourceID]++
			lastSource = r.sourceID
			r.taken = true
		}
	}

	return Result{
		Items:          out,
		TotalSeconds:   total, // informational only; not a budget
		TargetLow:      req.MinLow,
		TargetHigh:     req.MinHigh,
		PoolSize:       len(pool),
		PredictedItems: predicted,
	}
}

// SelectFor builds the Selected view for a single candidate at selectivity 1 -
// the session-agnostic effective score. It's used to rehydrate a stored session
// queue on resume (#67): the queue order is fixed at build time, so resume only
// needs each item's current score/reason/breakdown, not a re-rank. Score equals
// round2(ItemEffectiveScore), so the on-card cue, the breakdown, and the insights all
// agree and the ItemEffectiveScore == scoreOf(sel=1) invariant is preserved.
func SelectFor(c store.Candidate, now time.Time) Selected {
	return Selected{
		Item:        c.Item,
		SourceTitle: c.SourceTitle,
		Score:       round2(ItemEffectiveScore(c, now)),
		EstDuration: estDuration(c),
		Reason:      reasonOf(c, now),
		Breakdown:   ScoreBreakdownFor(c, now),
	}
}

// predictItems estimates how many items fit the time budget: budget divided by
// the insights's effective time-per-item. Effective time blends the feed's empirical
// content length (SourceStat.AvgContentSec) with the skim factor - because a
// 20-minute video the user skims in two minutes costs two minutes, not twenty.
func predictItems(req Request, pool []store.Candidate, stats map[int64]SourceStat) int {
	seen := map[int64]bool{}
	var sum float64
	var n int
	for _, c := range pool {
		if seen[c.SourceID] {
			continue
		}
		seen[c.SourceID] = true
		avg := stats[c.SourceID].AvgContentSec
		if avg > 0 {
			sum += avg * skimFactor
		} else {
			sum += articleEffSec
		}
		n++
	}
	avgEff := defaultAvgEffSec
	if n > 0 {
		avgEff = sum / float64(n)
	}
	budgetSec := float64((req.MinLow+req.MinHigh)/2) * 60
	if budgetSec <= 0 {
		budgetSec = 600
	}
	p := int(math.Round(budgetSec / avgEff))
	if p < 1 {
		p = 1
	}
	return p
}

// selectivity sharpens (>1) or flattens (<1) the weight/rarity term. When only a
// few items will be seen, sharpen so the scarce slots favor top sources; when
// many will be seen, flatten to admit more variety.
func selectivity(predicted int) float64 {
	switch {
	case predicted < 8:
		return 1.2
	case predicted > 25:
		return 0.9
	default:
		return 1.0
	}
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// scoreOf = (weight * rarity)^selectivity * freshness. The user-controlled knobs
// (weight directly; rarity via which sources they follow, ranked relative to the
// rest) stay legible; selectivity is the only budget-driven adjustment. sel > 1
// sharpens the favor toward high-weight sources when few items will be seen.
func scoreOf(c store.Candidate, now time.Time, sel float64) float64 {
	return math.Pow(weightRarity(c), sel) * freshness(c.PublishedAt, now, halfLifeOf(c))
}

// weightRarity is the user-controlled term of the score: the source's weight
// lifted by its relative-rarity boost. It carries no time or behavior signal -
// just "how much does the user favor this source, adjusted so a source that posts
// rarely for their feed isn't buried." Shared by the session ranker and the insights.
func weightRarity(c store.Candidate) float64 {
	return sourceWeight(c) * rarityOf(c)
}

// sourceWeight is the item's source weight with the "unset -> 1" default applied,
// the single place that default lives so weightRarity and ScoreBreakdownFor
// report the same Weight factor.
func sourceWeight(c store.Candidate) float64 {
	if c.SourceWeight <= 0 {
		return 1
	}
	return c.SourceWeight
}

// rarityOf reads the store-computed population-relative rarity boost (#110),
// defaulting to 1 (no boost) when unset. The store ranks each source's posting
// cadence against the user's other sources and hands the boost down on the
// candidate, so the ranker itself stays population-agnostic and the same value
// flows into sessions, the insights, and the breakdown.
func rarityOf(c store.Candidate) float64 {
	if c.RarityBoost <= 0 {
		return 1
	}
	return c.RarityBoost
}

// ItemIntendedScore is the session-agnostic "intended" contribution of a single
// item: weight × rarity × freshness, with selectivity fixed at 1. It answers "how
// much does this item want to be in the feed" - the numerator of the insights view's
// share.
func ItemIntendedScore(c store.Candidate, now time.Time) float64 {
	return weightRarity(c) * freshness(c.PublishedAt, now, halfLifeOf(c))
}

// ItemEffectiveScore is the session-agnostic contribution at selectivity 1 - what
// the item is actually worth to the ranker "if you browsed everything." Since the
// skip penalty was removed (#109), this is identical to ItemIntendedScore; both
// are retained so the insights's share basis and the intended/effective split still
// compile while the insights view is simplified separately. Equivalent to
// scoreOf(c, now, 1).
func ItemEffectiveScore(c store.Candidate, now time.Time) float64 {
	return ItemIntendedScore(c, now)
}

// halfLifeOf resolves the freshness half-life for a candidate per the hierarchy
// source override > feed (resolved) > global (#76). It returns the source's own
// override when set, else the resolved feed half-life; a 0 result falls through to
// the global default in freshness(). The store already applied the multi-feed rule
// to FeedHalfLifeDays, so the "which feed" ambiguity is settled before this. Every
// scoring path (ScoreBreakdownFor, scoreOf, ItemIntendedScore) funnels through
// here so sessions, the insights, and the breakdown resolve identically - that shared
// resolution is what keeps ItemEffectiveScore == scoreOf(sel=1) intact.
func halfLifeOf(c store.Candidate) float64 {
	if c.SourceHalfLifeDays > 0 {
		return c.SourceHalfLifeDays
	}
	return c.FeedHalfLifeDays
}

// freshness decays an item by age. halfLifeDays is the resolved per-item override
// when > 0, else the global freshnessHalfLifeDays. Both scoring paths pass
// halfLifeOf(c) so sessions and the insights decay identically.
func freshness(published, now time.Time, halfLifeDays float64) float64 {
	if halfLifeDays <= 0 {
		halfLifeDays = freshnessHalfLifeDays
	}
	ageDays := now.Sub(published).Hours() / 24
	if ageDays < 0 {
		ageDays = 0
	}
	return math.Pow(0.5, ageDays/halfLifeDays)
}

func estDuration(c store.Candidate) int {
	if c.DurationSec > 0 {
		return c.DurationSec
	}
	if d, ok := defaultDurationSec[c.MediaType]; ok {
		return d
	}
	return defaultDurationSec["unknown"]
}

// reasonOf picks the single most salient factor to show the user, so the "why
// am I seeing this" answer is honest and specific. The rare case keys off the
// store's relative-rarity boost (#110), not an absolute cadence.
func reasonOf(c store.Candidate, now time.Time) string {
	ageDays := now.Sub(c.PublishedAt).Hours() / 24
	switch {
	case c.SourceWeight >= 5:
		return "Favorite source"
	case c.RarityBoost >= 1.6:
		return "Rare - " + c.SourceTitle + " posts seldom for your feed, so it's surfaced"
	case ageDays < 1:
		return "Fresh - posted today"
	case c.SourceWeight >= 2:
		return "High-weight source"
	case ageDays < 3:
		return "Recent"
	default:
		return "From " + c.SourceTitle
	}
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

// WeightForBucket maps the UI's human words to a multiplier.
func WeightForBucket(bucket string) (float64, error) {
	switch bucket {
	case "very_low":
		return 0.25, nil
	case "low":
		return 0.5, nil
	case "normal":
		return 1, nil
	case "high":
		return 2, nil
	case "favorite":
		return 5, nil
	default:
		return 0, fmt.Errorf("unknown weight bucket %q", bucket)
	}
}
