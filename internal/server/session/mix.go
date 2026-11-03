package session

import (
	"math/rand"
	"sort"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// Mixed feeds (#201). A mix adds one level above source allocation: it decides
// which FORMAT fills the next slot, then the format's own source pool picks a
// source by representation exactly as Allocate does. Section weights scale the
// representation of every source in that section, so "more News" means News
// sources are picked more often inside whichever format is being filled.
//
// Shares are shares of session TIME, not of slots. Each pick charges its format
// the item's expected time (Cost): a 20-minute video uses twenty minutes of the
// video share, a Short about one. The next slot goes to the format whose next
// item, counted at its midpoint, leaves it furthest below its share of the time
// queued so far (the next item's cost is the representation-weighted mean of the
// format's source heads, since the source roll happens after the format pick):
//
//	pick f minimizing (used[f] + cost(next item of f)/2) / share[f]
//
// Counting the next item at its midpoint keeps every prefix of the queue within
// half an item of the target, so a long video neither jumps the queue nor starves
// waiting for the other formats to accumulate its full length. Exact ties (the
// first slot when costs and shares match) are broken by a weighted roll on share. A format with no eligible items
// drops out, and the remaining shares renormalize implicitly because the rule
// compares ratios. The default (no mix) path never reaches this file.

// Format is a session-mix format. "post" is derived from the source kind
// (Bluesky), not stored on the item: posts keep media_type 'article', so every
// existing content filter treats them as articles.
type Format string

const (
	FormatArticle Format = "article"
	FormatPost    Format = "post"
	FormatShort   Format = "short"
	FormatLong    Format = "long"
)

// Formats lists every mix format in display order.
var Formats = []Format{FormatArticle, FormatPost, FormatShort, FormatLong}

// postSourceKinds are the source kinds whose items count as social posts.
var postSourceKinds = map[string]bool{"bluesky": true}

// Expected time per item when the item carries no duration. Text is a session
// card read (headline, summary, sometimes opened), not the article's full length;
// time-based media (video, audio) uses its real duration when known.
const (
	articleCostSec = articleEffSec // 40s, the same skim estimate session sizing uses
	postCostSec    = 20.0
)

// Mix is a session's format shares and section weights. Shares are relative (they
// need not sum to 100); a format absent or at 0 is off. Section weights multiply
// source representation; a section absent from the map weighs 1, 0 excludes it.
// Sources without a section use weight 1.
type Mix struct {
	Formats  map[Format]float64 `json:"formats"`
	Sections map[string]float64 `json:"sections"`
}

// FormatOf classifies a candidate into a mix format. Articles include audio and
// every other non-video item, matching the session content controls.
func FormatOf(c store.Candidate, kind string) Format {
	switch c.MediaType {
	case "short":
		return FormatShort
	case "long", "live", "video":
		return FormatLong
	}
	if postSourceKinds[kind] {
		return FormatPost
	}
	return FormatArticle
}

// Cost is the expected session time of one item, in seconds.
func Cost(c store.Candidate, f Format) float64 {
	switch f {
	case FormatPost:
		return postCostSec
	case FormatShort, FormatLong:
		return float64(estDuration(c))
	}
	if c.MediaType == "audio" && c.DurationSec > 0 {
		return float64(c.DurationSec)
	}
	return articleCostSec
}

// SectionWeight resolves a section's weight in the mix (absent = 1).
func (m Mix) SectionWeight(slug string) float64 {
	if w, ok := m.Sections[slug]; ok {
		return w
	}
	return 1
}

// MixPick records the format and charged time of each queued item, in order; it
// is the mix's audit trail (and what the tests measure).
type MixPick struct {
	Format Format
	Cost   float64
}

// AllocateMix builds a session queue for a mix. It stops once the queued expected
// time reaches budgetSec, maxItems is hit, or every format is exhausted.
func AllocateMix(pool []store.Candidate, facts map[int64]store.SourceFacts, mix Mix, now time.Time, budgetSec float64, maxItems int, rng *rand.Rand) ([]Selected, []MixPick) {
	seed := rng.Int63()
	pools := map[Format]*sourcePool{}
	for _, c := range pool {
		f := facts[c.SourceID]
		format := FormatOf(c, f.Kind)
		if mix.Formats[format] <= 0 {
			continue
		}
		w := mix.SectionWeight(f.Section)
		if w <= 0 {
			continue
		}
		p := pools[format]
		if p == nil {
			p = newSourcePool(now, seed)
			pools[format] = p
		}
		p.add(c, representationOf(c)*w)
	}
	for _, p := range pools {
		p.order()
	}

	used := map[Format]float64{}
	var total float64
	out := make([]Selected, 0, maxItems)
	var picks []MixPick
	for len(out) < maxItems && total < budgetSec {
		format, ok := nextFormat(pools, mix, used, rng)
		if !ok {
			break
		}
		sel, _ := pools[format].next(rng)
		cost := Cost(candidateOf(sel), format)
		used[format] += cost
		total += cost
		out = append(out, sel)
		picks = append(picks, MixPick{Format: format, Cost: cost})
	}
	return out, picks
}

// nextFormat applies the midpoint rule over formats that still have items.
func nextFormat(pools map[Format]*sourcePool, mix Mix, used map[Format]float64, rng *rand.Rand) (Format, bool) {
	type cand struct {
		f     Format
		ratio float64
	}
	var cs []cand
	for _, f := range Formats {
		p := pools[f]
		if p == nil || p.empty() {
			continue
		}
		share := mix.Formats[f]
		cs = append(cs, cand{f, (used[f] + p.typicalCost(f)/2) / share})
	}
	if len(cs) == 0 {
		return "", false
	}
	sort.SliceStable(cs, func(i, j int) bool { return cs[i].ratio < cs[j].ratio })
	// Formats tied with the lowest ratio (always the case for the first slot when
	// costs match) share the slot by a weighted roll on share.
	tied := cs[:1]
	for _, c := range cs[1:] {
		if c.ratio-cs[0].ratio > 1e-9 {
			break
		}
		tied = append(tied, c)
	}
	if len(tied) == 1 {
		return tied[0].f, true
	}
	var sum float64
	for _, c := range tied {
		sum += mix.Formats[c.f]
	}
	roll := rng.Float64() * sum
	for _, c := range tied {
		roll -= mix.Formats[c.f]
		if roll < 0 {
			return c.f, true
		}
	}
	return tied[len(tied)-1].f, true
}

// typicalCost is the representation-weighted mean cost of each source's next
// item: the expected cost of whatever the next roll returns.
func (p *sourcePool) typicalCost(f Format) float64 {
	ids, w := p.live() // sorted, so the float sum is deterministic
	if w == 0 {
		return 0
	}
	var sum float64
	for _, sid := range ids {
		sum += Cost(p.bySource[sid][0], f) * p.repr[sid]
	}
	return sum / w
}

// candidateOf rebuilds the cost-relevant fields of an allocated item.
func candidateOf(s Selected) store.Candidate {
	return store.Candidate{Item: s.Item}
}
