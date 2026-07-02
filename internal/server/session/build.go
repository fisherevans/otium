// Package session builds a time-boxed, weighted, explainable consumption
// session from a pool of candidate items. This is otium's core: not an infinite
// ranked feed, but "given these sources, their weights, and how much time you
// want, here is a finite set worth your attention, and here is exactly why each
// item is in it."
//
// The scoring is deterministic - no black box. Every selected item carries a
// human-readable Reason derived from the same factors the ranker used.
package session

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// Tunables. These are the levers that would eventually become per-feed config.
const (
	freshnessHalfLifeDays = 21.0 // an item's freshness score halves every 3 weeks
	rareThresholdPerDay   = 1.0  // sources below this cadence are "rare" and get boosted
	rareBoostMax          = 1.0  // a ~never-posting source gets up to +100% score
)

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
type Selected struct {
	Item        store.Item `json:"item"`
	SourceTitle string     `json:"source_title"`
	Score       float64    `json:"score"`
	EstDuration int        `json:"est_duration_sec"`
	Reason      string     `json:"reason"`
}

// Result is a built session.
type Result struct {
	Items        []Selected `json:"items"`
	TotalSeconds int        `json:"total_seconds"`
	TargetLow    int        `json:"target_low_min"`
	TargetHigh   int        `json:"target_high_min"`
	PoolSize     int        `json:"pool_size"`
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
// video costs minutes - only the user's clock knows), refilling as it goes.
func Build(req Request, pool []store.Candidate, now time.Time) Result {
	k := req.QueueSize
	if k <= 0 {
		k = defaultQueueSize
	}

	ranked := make([]scored, 0, len(pool))
	for _, c := range pool {
		ranked = append(ranked, scored{
			c:        c,
			score:    scoreOf(c, now),
			dur:      estDuration(c),
			reason:   reasonOf(c, now),
			sourceID: c.SourceID,
		})
	}
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })

	perSourceUsed := map[int64]int{}
	var out []Selected
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
			cap := r.c.PerSessionCap
			if cap <= 0 {
				cap = 2
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
			})
			total += r.dur
			perSourceUsed[r.sourceID]++
			lastSource = r.sourceID
			r.taken = true
		}
	}

	return Result{
		Items:        out,
		TotalSeconds: total, // informational only; not a budget
		TargetLow:    req.MinLow,
		TargetHigh:   req.MinHigh,
		PoolSize:     len(pool),
	}
}

// scoreOf = weight * freshness * rarityBoost. All three are the knobs the user
// controls (weight directly; rarity/freshness indirectly via which sources they
// follow), which is what keeps the feed explainable.
func scoreOf(c store.Candidate, now time.Time) float64 {
	weight := c.SourceWeight
	if weight <= 0 {
		weight = 1
	}
	return weight * freshness(c.PublishedAt, now) * rarityBoost(c.SourceCadence)
}

func freshness(published, now time.Time) float64 {
	ageDays := now.Sub(published).Hours() / 24
	if ageDays < 0 {
		ageDays = 0
	}
	return math.Pow(0.5, ageDays/freshnessHalfLifeDays)
}

// rarityBoost lifts items from sources that post rarely so a once-a-week creator
// is never buried under a 30-a-day one. A source at/above rareThreshold gets 1x;
// a near-silent source approaches 1+rareBoostMax.
func rarityBoost(cadencePerDay float64) float64 {
	if cadencePerDay >= rareThresholdPerDay {
		return 1
	}
	return 1 + rareBoostMax*(rareThresholdPerDay-cadencePerDay)/rareThresholdPerDay
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
// am I seeing this" answer is honest and specific.
func reasonOf(c store.Candidate, now time.Time) string {
	ageDays := now.Sub(c.PublishedAt).Hours() / 24
	switch {
	case c.SourceWeight >= 5:
		return "Favorite source"
	case c.SourceCadence > 0 && c.SourceCadence < 0.25:
		return "Rare - " + c.SourceTitle + " posts seldom, so it's surfaced"
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
