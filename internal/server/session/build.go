// Package session builds a time-boxed consumption session from a pool of
// candidate items. Session engine v2 (#114): source-selection and article-ranking
// are separate concerns. The allocator (allocate.go) picks the next SOURCE by
// Representation and returns its freshest ELIGIBLE article; eligibility is a hard
// Archive-After cutoff. There is no rarity, no per-session cap, no selectivity and
// no behavioral downweight - a session is a relaxing, representative sample of the
// user's sources, not a backlog to clear.
//
// This file holds the shared article-level helpers (freshness, read-time
// prediction, the per-item Selected view + its breakdown). The article score is
// recency-based freshness only for now, kept as a distinct subsystem so future
// ranking signals (keyword boosts, topic relevance, quality) can slot in without
// touching the allocator.
package session

import (
	"fmt"
	"math"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// Tunables. freshnessHalfLifeDays shapes the recency score; the skim/read-time
// constants feed the session-size prediction only.
const (
	freshnessHalfLifeDays = 21.0

	skimFactor       = 0.4   // user typically spends ~40% of an item's length
	articleEffSec    = 40.0  // effective time for a duration-less item (an article)
	defaultAvgEffSec = 120.0 // fallback when we know nothing about the mix
)

// SourceStat is the per-source content signal used for session-size prediction.
// AvgContentSec is the empirical time-per-item; Shown/Skipped are carried for the
// stats surfaces (#116), not the ranker.
type SourceStat struct {
	AvgContentSec float64
	Shown         int
	Skipped       int
}

// defaultDurationSec estimates consume time when the feed didn't tell us.
var defaultDurationSec = map[string]int{
	"short":   60,
	"long":    600,
	"article": 240,
	"audio":   1800,
	"live":    1200,
	"unknown": 180,
}

// Selected is one item chosen for the session, with the ranker's rationale.
// Interest is the item's primary interest identity, filled by the handler after
// the allocator runs; nil for an interestless source.
type Selected struct {
	Item        store.Item         `json:"item"`
	SourceTitle string             `json:"source_title"`
	Interest    *store.InterestRef `json:"interest,omitempty"`
	Score       float64            `json:"score"`
	EstDuration int                `json:"est_duration_sec"`
	Reason      string             `json:"reason"`
	Breakdown   ScoreBreakdown     `json:"breakdown"`
}

// ScoreBreakdown is the per-factor decomposition shown as "why this item" (#18).
// Under engine v2 the article score is freshness only; Weight (a source's
// representation) and Rarity are retained as fields for wire-compatibility while
// the "explore score" surface (#120) replaces this UI - Rarity is always 1 now.
type ScoreBreakdown struct {
	Weight         float64 `json:"weight"`
	Rarity         float64 `json:"rarity"`
	Freshness      float64 `json:"freshness"`
	EffectiveScore float64 `json:"effective_score"`
	CadencePerDay  float64 `json:"cadence_per_day"`
	AgeDays        float64 `json:"age_days"`
}

// ScoreBreakdownFor decomposes an item's score. Engine v2: freshness drives the
// article score; Weight reports the source's representation, Rarity is inert (1).
func ScoreBreakdownFor(c store.Candidate, now time.Time) ScoreBreakdown {
	w := sourceWeight(c)
	fresh := freshness(c.PublishedAt, now, halfLifeOf(c))
	ageDays := now.Sub(c.PublishedAt).Hours() / 24
	if ageDays < 0 {
		ageDays = 0
	}
	return ScoreBreakdown{
		Weight:         w,
		Rarity:         1,
		Freshness:      fresh,
		EffectiveScore: fresh,
		CadencePerDay:  c.SourceCadence,
		AgeDays:        ageDays,
	}
}

// SelectFor builds the Selected view for a single candidate - used to rehydrate a
// stored session queue on resume (#67). Score is the item's current freshness.
func SelectFor(c store.Candidate, now time.Time) Selected {
	return selectedFrom(c, now)
}

// PredictItems estimates how many items fit the time budget: budget over the mix's
// effective time-per-item (content length blended with the skim factor). Used to
// size the allocator's queue, not to rank.
func PredictItems(durationMin int, pool []store.Candidate, stats map[int64]SourceStat) int {
	seen := map[int64]bool{}
	var sum float64
	var n int
	for _, c := range pool {
		if seen[c.SourceID] {
			continue
		}
		seen[c.SourceID] = true
		if avg := stats[c.SourceID].AvgContentSec; avg > 0 {
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
	budgetSec := float64(durationMin) * 60
	if budgetSec <= 0 {
		budgetSec = 600
	}
	p := int(math.Round(budgetSec / avgEff))
	if p < 1 {
		p = 1
	}
	return p
}

// ItemIntendedScore / ItemEffectiveScore are the per-item contributions the
// insights/composition view shares out. Engine v2 drops rarity and the skip
// penalty, so both are weight (representation) x freshness - "how much of your
// feed this source's item represents." Kept separate pending the insights rework.
func ItemIntendedScore(c store.Candidate, now time.Time) float64 {
	return sourceWeight(c) * freshness(c.PublishedAt, now, halfLifeOf(c))
}

func ItemEffectiveScore(c store.Candidate, now time.Time) float64 {
	return ItemIntendedScore(c, now)
}

// sourceWeight is the source's representation with the "unset -> 1" default.
func sourceWeight(c store.Candidate) float64 {
	if c.SourceWeight <= 0 {
		return 1
	}
	return c.SourceWeight
}

// halfLifeOf resolves the freshness half-life for a candidate (source > interest >
// global). Retained for the freshness score; Archive-After governs eligibility
// separately (allocate.go).
func halfLifeOf(c store.Candidate) float64 {
	if c.SourceHalfLifeDays > 0 {
		return c.SourceHalfLifeDays
	}
	return c.InterestHalfLifeDays
}

// freshness decays an item by age; halfLifeDays 0 falls back to the global default.
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

// reasonOf picks the single most salient factor for the "why am I seeing this"
// line. Engine v2: representation + recency (rarity is gone).
func reasonOf(c store.Candidate, now time.Time) string {
	ageDays := now.Sub(c.PublishedAt).Hours() / 24
	switch {
	case c.SourceWeight >= 4:
		return "You weight " + c.SourceTitle + " way up"
	case ageDays < 1:
		return "Fresh - posted today"
	case c.SourceWeight >= 2:
		return "You weight this source up"
	case ageDays < 3:
		return "Recent"
	default:
		return "From " + c.SourceTitle
	}
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

// WeightForBucket maps the UI's human words to a representation multiplier.
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
		return 4, nil
	default:
		return 0, fmt.Errorf("unknown weight bucket %q", bucket)
	}
}
