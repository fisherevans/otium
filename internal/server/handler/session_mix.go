package handler

import (
	"context"
	"math"
	mrand "math/rand"
	"time"

	"github.com/fisherevans/otium/internal/server/session"
	"github.com/fisherevans/otium/internal/server/store"
)

// Session mixes (#201): the request carries format shares and section weights;
// session.AllocateMix does the work. This file keeps the handler side out of the
// shared session handler.

const (
	maxMixShare         = 1000
	maxMixSectionWeight = 4
	// The queue covers twice the time budget so a fast reader does not run out;
	// every prefix of a mix queue holds its proportions, so the tail costs nothing.
	mixBudgetFactor = 2
	maxMixItems     = 80
)

// validateMix returns a user-facing message for an unusable mix, "" when valid.
func validateMix(m session.Mix) string {
	var sum float64
	for f, v := range m.Formats {
		valid := false
		for _, known := range session.Formats {
			valid = valid || f == known
		}
		if !valid {
			return "unknown mix format: " + string(f)
		}
		if v < 0 || v > maxMixShare || math.IsNaN(v) {
			return "mix shares must be between 0 and 1000"
		}
		sum += v
	}
	if sum <= 0 {
		return "give at least one format a share"
	}
	for _, w := range m.Sections {
		if w < 0 || w > maxMixSectionWeight || math.IsNaN(w) {
			return "section weights must be between 0 and 4"
		}
	}
	return ""
}

func (h *Handler) buildMixQueue(ctx context.Context, uid int64, durationMin int, pool []store.Candidate, mix session.Mix) ([]session.Selected, error) {
	facts, err := h.db.SourceMixFacts(ctx, uid)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	rng := mrand.New(mrand.NewSource(time.Now().UnixNano()))
	budget := float64(durationMin*60) * mixBudgetFactor
	items, picks := session.AllocateMix(pool, facts, mix, now, budget, maxMixItems, rng)
	h.log.Info("mix session built", "user", uid, "items", len(items), "shares", mixShares(picks, float64(durationMin*60)))
	if err := h.attachContent(ctx, uid, items); err != nil {
		return nil, err
	}
	h.attachTopics(ctx, uid, items)
	return items, nil
}

// mixShares reports the queued time per format within the session's own budget
// (the head the reader will actually reach), rounded to whole percents.
func mixShares(picks []session.MixPick, budget float64) map[session.Format]int {
	used := map[session.Format]float64{}
	var total float64
	for _, p := range picks {
		if total >= budget {
			break
		}
		used[p.Format] += p.Cost
		total += p.Cost
	}
	out := map[session.Format]int{}
	for f, v := range used {
		out[f] = int(math.Round(100 * v / total))
	}
	return out
}
