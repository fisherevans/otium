package session

import (
	"math/rand"
	"sort"
	"strings"
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

// evergreen marks "never archive" (Archive After = Never). The global default
// window is store.GlobalArchiveAfterDays - single-sourced there because the store's
// on-deck stat resolves the same chain in SQL and must not drift.
const evergreen = -1

// resolveArchiveAfter returns the effective Archive-After window in days for a
// candidate: source override > topic default > global. A non-zero value at
// any level wins (including -1 evergreen); 0 falls through to the next level.
func resolveArchiveAfter(c store.Candidate) int {
	if c.SourceArchiveAfterDays != 0 {
		return c.SourceArchiveAfterDays
	}
	if c.TopicArchiveAfterDays != 0 {
		return c.TopicArchiveAfterDays
	}
	return store.GlobalArchiveAfterDays
}

// eligible reports whether a candidate can appear in a session. A keyword match
// (#118) always excludes it. Otherwise eligibility is the source's resolved archive
// rule (#124): the age window (evergreen sources have no age limit), the keep-latest-N
// count rule (0 = off), and how the two combine ("and" | "or") when BOTH are active.
// The count rank is the item's recency position among its source's UNSEEN items
// (Candidate.RecencyRank), so as items are consumed the backlog slides up to refill
// the window - a rolling keep-latest-N, not a static published-at slice.
func eligible(c store.Candidate, now time.Time) bool {
	if keywordArchived(c) || categoryArchived(c) {
		return false
	}
	win := resolveArchiveAfter(c)
	ageIsLimit := win > 0 // evergreen (-1) or unresolved (0) is not an age limit
	countIsLimit := c.SourceArchiveKeepCount > 0
	switch {
	case !ageIsLimit && !countIsLimit:
		return true // OFF: evergreen with no count rule
	case ageIsLimit && !countIsLimit:
		return agePass(c, win, now)
	case !ageIsLimit && countIsLimit:
		return countPass(c) // count-only (evergreen age): keep the latest N
	case strings.EqualFold(c.SourceArchiveCombine, "or"):
		return agePass(c, win, now) || countPass(c)
	default: // "and"
		return agePass(c, win, now) && countPass(c)
	}
}

// agePass is the age rule: the item is within its resolved Archive-After window.
func agePass(c store.Candidate, win int, now time.Time) bool {
	ageDays := now.Sub(c.PublishedAt).Hours() / 24
	return ageDays <= float64(win)
}

// countPass is the keep-latest-N rule: the item is within the newest N unseen items
// of its source. RecencyRank is 1-based (newest = 1), resolved in SQL.
func countPass(c store.Candidate) bool {
	return c.RecencyRank > 0 && c.RecencyRank <= c.SourceArchiveKeepCount
}

// keywordArchived reports whether the item's title or summary contains any of the
// source's auto-archive keywords (#118), case-insensitively.
func keywordArchived(c store.Candidate) bool {
	if c.SourceArchiveKeywords == "" {
		return false
	}
	hay := strings.ToLower(c.Title + " " + c.Summary)
	for _, kw := range strings.Split(c.SourceArchiveKeywords, ",") {
		kw = strings.TrimSpace(strings.ToLower(kw))
		if kw != "" && strings.Contains(hay, kw) {
			return true
		}
	}
	return false
}

// categoryArchived reports whether any of the item's RSS categories matches the
// source's auto-archive category blocklist (#142), case-insensitively. A blocklist
// entry matches when it appears as a substring of an item category, so blocking
// "Obituaries" also catches a source that tags "Obituaries / Life Lines". The
// blocklist is newline-separated (category values legitimately contain commas,
// e.g. "Food + Drink"); item categories come from gofeed's <category> parsing.
func categoryArchived(c store.Candidate) bool {
	if c.SourceArchiveCategories == "" || len(c.Categories) == 0 {
		return false
	}
	lowered := make([]string, len(c.Categories))
	for i, cat := range c.Categories {
		lowered[i] = strings.ToLower(cat)
	}
	for _, blocked := range strings.Split(c.SourceArchiveCategories, "\n") {
		blocked = strings.TrimSpace(strings.ToLower(blocked))
		if blocked == "" {
			continue
		}
		for _, cat := range lowered {
			if strings.Contains(cat, blocked) {
				return true
			}
		}
	}
	return false
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
	seed := rng.Int63() // stable within this build; drives the random-by-age direction (#124)
	ps := newSourcePool(now, seed)
	for _, c := range pool {
		ps.add(c, representationOf(c))
	}
	ps.order()

	out := make([]Selected, 0, target) // never nil: an empty session serializes as []
	for len(out) < target {
		sel, ok := ps.next(rng)
		if !ok {
			break
		}
		out = append(out, sel)
	}
	return out
}

// sourcePool is the per-source queue the allocator draws from: each source's
// eligible articles in its scoring order, plus the source's effective weight for
// the weighted-random roll. Allocate uses one pool for the whole session; a mix
// (mix.go) uses one per format.
type sourcePool struct {
	now      time.Time
	seed     int64
	bySource map[int64][]store.Candidate
	repr     map[int64]float64
	// facetScore holds the per-item scoring-facet product for sources that opted into
	// a non-default scoring config (#124), so Selected.Score reflects the real order
	// instead of freshness. Absent for default (newest, no facets) sources, which keep
	// their byte-identical pure-recency ordering and freshness score.
	facetScore map[int64]float64
}

func newSourcePool(now time.Time, seed int64) *sourcePool {
	return &sourcePool{now: now, seed: seed, bySource: map[int64][]store.Candidate{}, repr: map[int64]float64{}, facetScore: map[int64]float64{}}
}

// add queues an eligible candidate under its source with the source's weight.
// Ineligible candidates are dropped here.
func (p *sourcePool) add(c store.Candidate, weight float64) {
	if !eligible(c, p.now) {
		return
	}
	p.bySource[c.SourceID] = append(p.bySource[c.SourceID], c)
	p.repr[c.SourceID] = weight
}

// order sorts each source's queue: pure recency for default scoring, the facet
// order otherwise.
func (p *sourcePool) order() {
	for sid, cs := range p.bySource {
		cfg := parseScoring(cs[0].ScoringConfig) // source-level: all its items share it
		if cfg.isDefault() {
			sort.SliceStable(cs, func(i, j int) bool { return cs[i].PublishedAt.After(cs[j].PublishedAt) })
		} else {
			for id, s := range orderSource(cs, cfg, p.seed, p.now) {
				p.facetScore[id] = s
			}
		}
		p.bySource[sid] = cs
	}
}

// live lists the sources that still have articles, in id order.
func (p *sourcePool) live() ([]int64, float64) {
	var ids []int64
	var totalW float64
	for sid, cs := range p.bySource {
		if len(cs) > 0 {
			ids = append(ids, sid)
			totalW += p.repr[sid]
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] }) // stable order for the weighted roll
	return ids, totalW
}

// next picks a source weighted-random by its weight and takes that source's next
// article. ok is false when the pool is exhausted.
func (p *sourcePool) next(rng *rand.Rand) (Selected, bool) {
	sid, ok := p.roll(rng)
	if !ok {
		return Selected{}, false
	}
	return p.take(sid), true
}

// roll picks a source weighted-random by its weight without consuming anything.
func (p *sourcePool) roll(rng *rand.Rand) (int64, bool) {
	ids, totalW := p.live()
	if len(ids) == 0 {
		return 0, false
	}
	roll := rng.Float64() * totalW
	pick := ids[len(ids)-1]
	var acc float64
	for _, sid := range ids {
		acc += p.repr[sid]
		if roll < acc {
			pick = sid
			break
		}
	}
	return pick, true
}

// take consumes and returns the source's next article.
func (p *sourcePool) take(sid int64) Selected {
	cs := p.bySource[sid]
	sel := selectedFrom(cs[0], p.now)
	if s, ok := p.facetScore[cs[0].ID]; ok {
		sel.Score = round2(s) // non-default scoring: report the facet product, not freshness
	}
	p.bySource[sid] = cs[1:]
	return sel
}

// selectedFrom builds the Selected view for one allocated article. The article
// score is recency-based freshness only (#115) - within a source the ranker is
// chronological. Reason/breakdown are transitional until the "explore score"
// surface (#116/#120) replaces them.
func selectedFrom(c store.Candidate, now time.Time) Selected {
	return Selected{
		Item:          c.Item,
		SourceTitle:   c.SourceTitle,
		SourceIconURL: c.SourceIconURL,
		Score:         round2(freshness(c.PublishedAt, now, freshnessHalfLifeDays)),
		EstDuration:   estDuration(c),
		Reason:        reasonOf(c, now),
		Breakdown:     ScoreBreakdownFor(c, now),
	}
}
