package session

import (
	"math/rand"
	"sort"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// Mixed feeds (#201). A mix adds one level above source allocation: it decides
// which FORMAT fills the next slot, then takes an item from a source in that
// format picked by representation, as Allocate does. Section weights scale the
// representation of every source in that section, so "more News" means News
// sources are picked more often inside whichever format is being filled.
//
// Shares are shares of session TIME, not of slots. Each pick charges its format
// the item's expected time (Cost): a 20-minute video uses twenty minutes of the
// video share, a Short about one. Each slot rolls a source in every format that
// still has items, so the rule sees each candidate's real length, then goes to
// the format whose candidate, counted at its midpoint, leaves it furthest below
// its share of the time queued so far:
//
//	pick f minimizing (used[f] + cost(candidate of f)/2) / share[f]
//
// The winner's roll is taken; the other rolls are discarded. Counting at the
// midpoint keeps every prefix of the queue within about half an item of the
// target, so a long video neither jumps the queue nor waits for the other
// formats to accumulate its full length. A video longer than its format's share
// of the whole session therefore lands past the session's end, and because every
// slot re-rolls, a shorter video from another source can take the slot instead.
// Exact ties are broken by a weighted roll on share. A format with no eligible
// items drops out and the remaining shares renormalize implicitly, because the
// rule compares ratios. The default (no mix) path never reaches this file.

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
		format, sid, ok := nextFormat(pools, mix, used, rng)
		if !ok {
			break
		}
		sel := pools[format].take(sid)
		cost := Cost(candidateOf(sel), format)
		used[format] += cost
		total += cost
		out = append(out, sel)
		picks = append(picks, MixPick{Format: format, Cost: cost})
	}
	return out, picks
}

// nextFormat rolls a source in every format that still has items, then applies
// the midpoint rule using each rolled item's real cost. It returns the chosen
// format and its rolled source; the other rolls are discarded.
func nextFormat(pools map[Format]*sourcePool, mix Mix, used map[Format]float64, rng *rand.Rand) (Format, int64, bool) {
	type cand struct {
		f     Format
		sid   int64
		ratio float64
	}
	var cs []cand
	for _, f := range Formats {
		p := pools[f]
		if p == nil {
			continue
		}
		sid, ok := p.roll(rng)
		if !ok {
			continue
		}
		cost := Cost(p.bySource[sid][0], f)
		cs = append(cs, cand{f, sid, (used[f] + cost/2) / mix.Formats[f]})
	}
	if len(cs) == 0 {
		return "", 0, false
	}
	sort.SliceStable(cs, func(i, j int) bool { return cs[i].ratio < cs[j].ratio })
	// Exact ties share the slot by a weighted roll on share.
	tied := cs[:1]
	for _, c := range cs[1:] {
		if c.ratio-cs[0].ratio > 1e-9 {
			break
		}
		tied = append(tied, c)
	}
	if len(tied) == 1 {
		return tied[0].f, tied[0].sid, true
	}
	var sum float64
	for _, c := range tied {
		sum += mix.Formats[c.f]
	}
	roll := rng.Float64() * sum
	for _, c := range tied {
		roll -= mix.Formats[c.f]
		if roll < 0 {
			return c.f, c.sid, true
		}
	}
	last := tied[len(tied)-1]
	return last.f, last.sid, true
}

// candidateOf rebuilds the cost-relevant fields of an allocated item.
func candidateOf(s Selected) store.Candidate {
	return store.Candidate{Item: s.Item}
}
