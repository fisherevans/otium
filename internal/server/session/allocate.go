package session

import (
	"math/rand"
	"sort"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// Session engine v2 (#114/#115). Source-selection and article-ranking are
// separate concerns. The allocator picks the next SOURCE by Representation
// (weighted-random), then returns that source's freshest ELIGIBLE article.
// Eligibility is a hard Archive-After cutoff on age - old news quietly expires.
// There is no rarity, no per-session cap, no selectivity: Representation alone
// shapes how much of a session each source occupies, so a high-volume source
// never drowns a low-volume one and a session is a relaxing, representative
// sample rather than a backlog to clear.

const (
	// globalArchiveAfterDays is the default eligibility window when neither the
	// source nor its interest sets one.
	globalArchiveAfterDays = 21
	// evergreen marks "never archive" (Archive After = Never).
	evergreen = -1
)

// resolveArchiveAfter returns the effective Archive-After window in days for a
// candidate: source override > interest default > global. A non-zero value at
// any level wins (including -1 evergreen); 0 falls through to the next level.
func resolveArchiveAfter(c store.Candidate) int {
	if c.SourceArchiveAfterDays != 0 {
		return c.SourceArchiveAfterDays
	}
	if c.InterestArchiveAfterDays != 0 {
		return c.InterestArchiveAfterDays
	}
	return globalArchiveAfterDays
}

// eligible reports whether a candidate is still within its Archive-After window.
// Evergreen sources are always eligible.
func eligible(c store.Candidate, now time.Time) bool {
	win := resolveArchiveAfter(c)
	if win == evergreen {
		return true
	}
	ageDays := now.Sub(c.PublishedAt).Hours() / 24
	return ageDays <= float64(win)
}

// representationOf is the source's session-occupancy multiplier (Representation,
// #115), defaulting to 1. It is NOT an article-score multiplier - it only shapes
// how often the source is chosen to contribute the next slot. (Carried on
// Candidate.SourceWeight until the weight->representation rename lands.)
func representationOf(c store.Candidate) float64 {
	if c.SourceWeight <= 0 {
		return 1
	}
	return c.SourceWeight
}

// Allocate builds a session queue by repeatedly choosing a source weighted by its
// Representation (weighted-random) and taking that source's freshest eligible
// article, until `target` items or the eligible pool is exhausted. Article order
// within a source is pure recency (newest first) - a hard Archive-After cutoff,
// no decay curve. Sampling is without replacement across the whole call. An empty
// source is skipped and its representation redistributes naturally among the rest.
// rng makes it seedable/testable; a per-session seed keeps a rebuild stable.
func Allocate(pool []store.Candidate, now time.Time, target int, rng *rand.Rand) []Selected {
	bySource := map[int64][]store.Candidate{}
	repr := map[int64]float64{}
	for _, c := range pool {
		if !eligible(c, now) {
			continue
		}
		bySource[c.SourceID] = append(bySource[c.SourceID], c)
		repr[c.SourceID] = representationOf(c)
	}
	for sid, cs := range bySource {
		sort.SliceStable(cs, func(i, j int) bool { return cs[i].PublishedAt.After(cs[j].PublishedAt) })
		bySource[sid] = cs
	}

	out := make([]Selected, 0, target) // never nil: an empty session serializes as []
	for len(out) < target {
		var ids []int64
		var totalW float64
		for sid, cs := range bySource {
			if len(cs) > 0 {
				ids = append(ids, sid)
				totalW += repr[sid]
			}
		}
		if len(ids) == 0 {
			break
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] }) // stable order for the weighted roll
		roll := rng.Float64() * totalW
		pick := ids[len(ids)-1]
		var acc float64
		for _, sid := range ids {
			acc += repr[sid]
			if roll < acc {
				pick = sid
				break
			}
		}
		cs := bySource[pick]
		out = append(out, selectedFrom(cs[0], now))
		bySource[pick] = cs[1:]
	}
	return out
}

// selectedFrom builds the Selected view for one allocated article. The article
// score is recency-based freshness only (#115) - within a source the ranker is
// chronological. Reason/breakdown are transitional until the "explore score"
// surface (#116/#120) replaces them.
func selectedFrom(c store.Candidate, now time.Time) Selected {
	return Selected{
		Item:        c.Item,
		SourceTitle: c.SourceTitle,
		Score:       round2(freshness(c.PublishedAt, now, freshnessHalfLifeDays)),
		EstDuration: estDuration(c),
		Reason:      reasonOf(c, now),
		Breakdown:   ScoreBreakdownFor(c, now),
	}
}
