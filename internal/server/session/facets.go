package session

import (
	"encoding/json"
	"hash/fnv"
	"sort"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// Per-source article scoring (#124, Capability 1). Within a source the order is a
// product of 0..1 facet scores, each derived from the source's ScoringConfig. The
// DEFAULT config (newest direction, no facets) reproduces pure recency and is
// handled by the allocator's fast path WITHOUT this machinery, so a default source
// stays byte-identical to the pre-#124 behavior. This file only runs for a source
// that has opted into a non-default config.
//
// Facet contract: every facet returns a value in 0..1, and scoreItem multiplies
// them. A facet is "saturating + floored" - it never returns 0 (which would drop an
// item entirely); it down-weights instead. Eligibility (allocate.go) decides what
// appears at all; scoring only decides the order among the eligible.

// ScoringConfig is a source's per-article scoring, stored as JSON in
// sources.scoring_config. Zero value = default (newest, no facets).
type ScoringConfig struct {
	// Direction shapes the age facet: "" / "newest" (default), "oldest", "random".
	Direction string `json:"direction,omitempty"`
	// Length, when set, layers a duration preference on top of the age facet.
	Length *LengthFacet `json:"length,omitempty"`
}

// LengthFacet prefers longer or shorter items by raw duration_sec (#124). It
// saturates (a 3-hour item isn't unboundedly better than a 30-minute one) and is
// floored so a short or duration-less item is only down-weighted, never omitted.
type LengthFacet struct {
	Prefer string `json:"prefer"` // "longer" | "shorter"
}

const (
	// lengthMidpointSec is where the length facet crosses ~0.5 - a 10-minute item is
	// "medium". lengthFloor keeps the shortest items in the running (down-weighted).
	lengthMidpointSec = 600.0
	lengthFloor       = 0.1
)

// isDefault reports the zero-cost path: newest recency with no facets, identical to
// the pre-#124 allocator.
func (c ScoringConfig) isDefault() bool {
	return (c.Direction == "" || c.Direction == "newest") && c.Length == nil
}

// parseScoring decodes a source's scoring_config JSON; a blank or malformed value
// falls back to the default config (fail safe: never break a session build on a bad
// blob).
func parseScoring(s string) ScoringConfig {
	if s == "" {
		return ScoringConfig{}
	}
	var c ScoringConfig
	if err := json.Unmarshal([]byte(s), &c); err != nil {
		return ScoringConfig{}
	}
	return c
}

// orderSource sorts a source's eligible candidates in place by the config's facet
// product (highest first) and returns each item's score for the "why this" surface.
// seed makes the random direction deterministic within a build (persistence handles
// resume; a fresh build re-rolls). now anchors the age facet.
func orderSource(cs []store.Candidate, cfg ScoringConfig, seed int64, now time.Time) map[int64]float64 {
	// Set-relative age normalization: 0 = oldest in this set, 1 = newest. A single
	// item (or all-equal timestamps) normalizes to 1 so it isn't zeroed out.
	var oldest, newest time.Time
	for i, c := range cs {
		if i == 0 || c.PublishedAt.Before(oldest) {
			oldest = c.PublishedAt
		}
		if i == 0 || c.PublishedAt.After(newest) {
			newest = c.PublishedAt
		}
	}
	span := newest.Sub(oldest).Seconds()
	ageNorm := func(t time.Time) float64 {
		if span <= 0 {
			return 1
		}
		return t.Sub(oldest).Seconds() / span
	}

	scores := make(map[int64]float64, len(cs))
	for _, c := range cs {
		var age float64
		switch cfg.Direction {
		case "oldest":
			age = 1 - ageNorm(c.PublishedAt)
		case "random":
			age = hash01(seed, c.ID)
		default: // newest
			age = ageNorm(c.PublishedAt)
		}
		s := age
		if cfg.Length != nil {
			s *= lengthScore(c.DurationSec, cfg.Length.Prefer)
		}
		scores[c.ID] = s
	}
	sort.SliceStable(cs, func(i, j int) bool {
		si, sj := scores[cs[i].ID], scores[cs[j].ID]
		if si != sj {
			return si > sj
		}
		// Deterministic tie-break: newer first, then id, so a rebuild is stable.
		if !cs[i].PublishedAt.Equal(cs[j].PublishedAt) {
			return cs[i].PublishedAt.After(cs[j].PublishedAt)
		}
		return cs[i].ID > cs[j].ID
	})
	return scores
}

// lengthScore maps raw duration to 0..1, saturating around lengthMidpointSec and
// floored at lengthFloor. "longer" scores long items up; "shorter" inverts. A
// duration-less item (0s, e.g. an un-enriched YouTube video) reads as maximally
// short - down-weighted for "longer", boosted for "shorter" - never dropped.
func lengthScore(durationSec int, prefer string) float64 {
	d := float64(durationSec)
	if d < 0 {
		d = 0
	}
	// Saturating longer-preference in 0..1: d / (d + midpoint).
	long := d / (d + lengthMidpointSec)
	s := long
	if prefer == "shorter" {
		s = 1 - long
	}
	if s < lengthFloor {
		s = lengthFloor
	}
	return s
}

// hash01 maps (seed, id) to a stable value in [0,1) via FNV, so the random age
// direction is deterministic for a given build rather than depending on map-walk
// order (which would reshuffle on every rebuild).
func hash01(seed, id int64) float64 {
	h := fnv.New64a()
	var b [16]byte
	putInt64(b[0:8], seed)
	putInt64(b[8:16], id)
	h.Write(b[:])
	return float64(h.Sum64()>>11) / float64(1<<53)
}

func putInt64(b []byte, v int64) {
	u := uint64(v)
	for i := 0; i < 8; i++ {
		b[i] = byte(u >> (8 * i))
	}
}
