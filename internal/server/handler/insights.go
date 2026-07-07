package handler

import (
	"net/http"
	"sort"
	"time"

	"github.com/fisherevans/otium/internal/server/session"
	"github.com/fisherevans/otium/internal/server/store"
)

// insightsCadenceDays is the window used to compute each source's posting cadence for
// the rarity boost in the insights score. Matches the session builder's default
// candidate window so the insights's rarity semantics line up with what sessions do.
const insightsCadenceDays = 45

// InsightsSource is one source's live slice of the interest. EffectiveShare is its share
// of the full ranker score (incl. skip penalty) - "what you actually see".
// IntendedShare drops the skip penalty - "what it wants to be" - so the gap
// between the two, read next to SkipPct, is the inefficiency signal: a big
// intended slice you mostly skip is a prune candidate.
type InsightsSource struct {
	SourceID       int64              `json:"source_id"`
	SourceTitle    string             `json:"source_title"`
	Interest       *store.InterestRef `json:"interest"` // the source's one interest (#86); null for a interestless source
	EffectiveShare float64            `json:"effective_share"`
	IntendedShare  float64            `json:"intended_share"`
	SkipPct        float64            `json:"skip_pct"`
	ItemCount      int                `json:"item_count"`
	Weight         float64            `json:"weight"`
}

// InsightsInterest is a per-interest rollup: the summed shares of its member sources. A nil
// Interest is the interestless bucket (sources belonging to no interest).
type InsightsInterest struct {
	Interest       *store.InterestRef `json:"interest"`
	EffectiveShare float64            `json:"effective_share"`
	IntendedShare  float64            `json:"intended_share"`
	SourceCount    int                `json:"source_count"`
	ItemCount      int                `json:"item_count"`
}

type InsightsTotals struct {
	SourceCount int `json:"source_count"`
	ItemCount   int `json:"item_count"`
}

// InsightsResponse is the /insights payload. Shares are normalized so the source list (and
// the interest rollup) each sum to 1 over the scope; when scope=="interest" everything is
// renormalized within that interest's sources.
type InsightsResponse struct {
	Scope     string             `json:"scope"`              // "all" | "interest"
	Interest  string             `json:"interest,omitempty"` // slug, when scope=="interest"
	Sources   []InsightsSource   `json:"sources"`
	Interests []InsightsInterest `json:"interests"`
	Totals    InsightsTotals     `json:"totals"`
}

// Insights computes the live effective share of each source: sum the current
// freshness-decayed ranker score of all its known items, normalized against the
// grand total. Just-in-time - the half-life is evaluated now, so old items decay
// to ~0 and the insights drifts as content ages. Read-only: emits no engagement events.
func (h *Handler) Insights(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	interestSlug := r.URL.Query().Get("interest")
	scope := "all"
	var sourceIDs []int64
	if interestSlug != "" {
		scope = "interest"
		ids, err := h.db.SourceIDsForInterests(r.Context(), uid, []string{interestSlug})
		if err != nil {
			serverError(w, h.log, "insights resolve interest", err)
			return
		}
		sourceIDs = ids
		if len(sourceIDs) == 0 {
			// A interest with no sources yields an empty insights, not "all".
			writeJSON(w, http.StatusOK, InsightsResponse{Scope: scope, Interest: interestSlug, Sources: []InsightsSource{}, Interests: []InsightsInterest{}})
			return
		}
	}

	items, err := h.db.InsightsItems(r.Context(), uid, sourceIDs, insightsCadenceDays)
	if err != nil {
		serverError(w, h.log, "insights items", err)
		return
	}
	skips, err := h.db.SourceSkipStats(r.Context(), uid)
	if err != nil {
		serverError(w, h.log, "insights skip stats", err)
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
		eff := session.ItemEffectiveScore(c, now)
		intd := session.ItemIntendedScore(c, now)
		a.effSum += eff
		a.intSum += intd
		a.itemCount++
		grandEff += eff
		grandInt += intd
	}

	interestOf := map[int64]store.InterestRef{}
	if len(order) > 0 {
		if m, err := h.db.InterestsForSources(r.Context(), uid, order); err != nil {
			h.log.Warn("insights interests", "err", err)
		} else {
			interestOf = m
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

	sources := make([]InsightsSource, 0, len(order))
	interestAgg := map[string]*InsightsInterest{}
	var interestKeys []string
	totalItems := 0
	for _, sid := range order {
		a := byID[sid]
		sk := stats[sid]
		skipPct := 0.0
		if sk.Shown > 0 {
			skipPct = float64(sk.Skipped) / float64(sk.Shown)
		}
		var fref *store.InterestRef
		if f, ok := interestOf[sid]; ok {
			fc := f
			fref = &fc
		}
		es := shareEff(a.effSum)
		is := shareInt(a.intSum)
		sources = append(sources, InsightsSource{
			SourceID:       sid,
			SourceTitle:    a.title,
			Interest:       fref,
			EffectiveShare: es,
			IntendedShare:  is,
			SkipPct:        skipPct,
			ItemCount:      a.itemCount,
			Weight:         a.weight,
		})
		totalItems += a.itemCount

		key := "" // "" = interestless bucket
		if fref != nil {
			key = fref.Slug
		}
		mf := interestAgg[key]
		if mf == nil {
			mf = &InsightsInterest{Interest: fref}
			interestAgg[key] = mf
			interestKeys = append(interestKeys, key)
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

	interests := make([]InsightsInterest, 0, len(interestKeys))
	for _, k := range interestKeys {
		interests = append(interests, *interestAgg[k])
	}
	sort.SliceStable(interests, func(i, j int) bool { return interests[i].EffectiveShare > interests[j].EffectiveShare })

	writeJSON(w, http.StatusOK, InsightsResponse{
		Scope:     scope,
		Interest:  interestSlug,
		Sources:   sources,
		Interests: interests,
		Totals:    InsightsTotals{SourceCount: len(sources), ItemCount: totalItems},
	})
}
