package handler

import (
	"net/http"
	"sort"
	"time"

	"github.com/fisherevans/otium/internal/server/session"
	"github.com/fisherevans/otium/internal/server/store"
)

// mixCadenceDays is the window used to compute each source's posting cadence for
// the rarity boost in the mix score. Matches the session builder's default
// candidate window so the mix's rarity semantics line up with what sessions do.
const mixCadenceDays = 45

// MixSource is one source's live slice of the feed. EffectiveShare is its share
// of the full ranker score (incl. skip penalty) - "what you actually see".
// IntendedShare drops the skip penalty - "what it wants to be" - so the gap
// between the two, read next to SkipPct, is the inefficiency signal: a big
// intended slice you mostly skip is a prune candidate.
type MixSource struct {
	SourceID       int64          `json:"source_id"`
	SourceTitle    string         `json:"source_title"`
	Feed           *store.FeedRef `json:"feed"` // primary feed identity; null for a feedless source
	EffectiveShare float64        `json:"effective_share"`
	IntendedShare  float64        `json:"intended_share"`
	SkipPct        float64        `json:"skip_pct"`
	ItemCount      int            `json:"item_count"`
	Weight         float64        `json:"weight"`
}

// MixFeed is a per-feed rollup: the summed shares of its member sources. A nil
// Feed is the feedless bucket (sources belonging to no feed).
type MixFeed struct {
	Feed           *store.FeedRef `json:"feed"`
	EffectiveShare float64        `json:"effective_share"`
	IntendedShare  float64        `json:"intended_share"`
	SourceCount    int            `json:"source_count"`
	ItemCount      int            `json:"item_count"`
}

type MixTotals struct {
	SourceCount int `json:"source_count"`
	ItemCount   int `json:"item_count"`
}

// MixResponse is the /mix payload. Shares are normalized so the source list (and
// the feed rollup) each sum to 1 over the scope; when scope=="feed" everything is
// renormalized within that feed's sources.
type MixResponse struct {
	Scope   string      `json:"scope"`          // "all" | "feed"
	Feed    string      `json:"feed,omitempty"` // slug, when scope=="feed"
	Sources []MixSource `json:"sources"`
	Feeds   []MixFeed   `json:"feeds"`
	Totals  MixTotals   `json:"totals"`
}

// Mix computes the live effective share of each source: sum the current
// freshness-decayed ranker score of all its known items, normalized against the
// grand total. Just-in-time - the half-life is evaluated now, so old items decay
// to ~0 and the mix drifts as content ages. Read-only: emits no engagement events.
func (h *Handler) Mix(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	feedSlug := r.URL.Query().Get("feed")
	scope := "all"
	var sourceIDs []int64
	if feedSlug != "" {
		scope = "feed"
		ids, err := h.db.SourceIDsForFeeds(r.Context(), uid, []string{feedSlug})
		if err != nil {
			serverError(w, h.log, "mix resolve feed", err)
			return
		}
		sourceIDs = ids
		if len(sourceIDs) == 0 {
			// A feed with no sources yields an empty mix, not "all".
			writeJSON(w, http.StatusOK, MixResponse{Scope: scope, Feed: feedSlug, Sources: []MixSource{}, Feeds: []MixFeed{}})
			return
		}
	}

	items, err := h.db.MixItems(r.Context(), uid, sourceIDs, mixCadenceDays)
	if err != nil {
		serverError(w, h.log, "mix items", err)
		return
	}
	skips, err := h.db.SourceSkipStats(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "mix skip stats", err)
		return
	}
	stats := map[int64]session.SourceStat{}
	for sid, sk := range skips {
		stats[sid] = session.SourceStat{Shown: sk.Shown, Skipped: sk.Skipped}
	}

	now := time.Now().UTC()
	type agg struct {
		title          string
		weight         float64
		effSum, intSum float64
		itemCount      int
	}
	byID := map[int64]*agg{}
	var order []int64 // source ids in stable (query) order
	var grandEff, grandInt float64
	for i := range items {
		c := items[i]
		a := byID[c.SourceID]
		if a == nil {
			a = &agg{title: c.SourceTitle, weight: c.SourceWeight}
			byID[c.SourceID] = a
			order = append(order, c.SourceID)
		}
		eff := session.ItemEffectiveScore(c, now, stats[c.SourceID])
		intd := session.ItemIntendedScore(c, now)
		a.effSum += eff
		a.intSum += intd
		a.itemCount++
		grandEff += eff
		grandInt += intd
	}

	feedOf := map[int64]store.FeedRef{}
	if len(order) > 0 {
		if m, err := h.db.PrimaryFeedsForSources(r.Context(), uid, order); err != nil {
			h.log.Warn("mix primary feeds", "err", err)
		} else {
			feedOf = m
		}
	}

	shareEff := func(v float64) float64 {
		if grandEff <= 0 {
			return 0
		}
		return v / grandEff
	}
	shareInt := func(v float64) float64 {
		if grandInt <= 0 {
			return 0
		}
		return v / grandInt
	}

	sources := make([]MixSource, 0, len(order))
	feedAgg := map[string]*MixFeed{}
	var feedKeys []string
	totalItems := 0
	for _, sid := range order {
		a := byID[sid]
		sk := stats[sid]
		skipPct := 0.0
		if sk.Shown > 0 {
			skipPct = float64(sk.Skipped) / float64(sk.Shown)
		}
		var fref *store.FeedRef
		if f, ok := feedOf[sid]; ok {
			fc := f
			fref = &fc
		}
		es := shareEff(a.effSum)
		is := shareInt(a.intSum)
		sources = append(sources, MixSource{
			SourceID:       sid,
			SourceTitle:    a.title,
			Feed:           fref,
			EffectiveShare: es,
			IntendedShare:  is,
			SkipPct:        skipPct,
			ItemCount:      a.itemCount,
			Weight:         a.weight,
		})
		totalItems += a.itemCount

		key := "" // "" = feedless bucket
		if fref != nil {
			key = fref.Slug
		}
		mf := feedAgg[key]
		if mf == nil {
			mf = &MixFeed{Feed: fref}
			feedAgg[key] = mf
			feedKeys = append(feedKeys, key)
		}
		mf.EffectiveShare += es
		mf.IntendedShare += is
		mf.SourceCount++
		mf.ItemCount += a.itemCount
	}

	sort.SliceStable(sources, func(i, j int) bool {
		if sources[i].EffectiveShare != sources[j].EffectiveShare {
			return sources[i].EffectiveShare > sources[j].EffectiveShare
		}
		return sources[i].SourceID < sources[j].SourceID
	})

	feeds := make([]MixFeed, 0, len(feedKeys))
	for _, k := range feedKeys {
		feeds = append(feeds, *feedAgg[k])
	}
	sort.SliceStable(feeds, func(i, j int) bool { return feeds[i].EffectiveShare > feeds[j].EffectiveShare })

	writeJSON(w, http.StatusOK, MixResponse{
		Scope:   scope,
		Feed:    feedSlug,
		Sources: sources,
		Feeds:   feeds,
		Totals:  MixTotals{SourceCount: len(sources), ItemCount: totalItems},
	})
}
