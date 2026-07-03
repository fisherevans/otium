package store

import (
	"context"
	"strconv"
	"testing"
	"time"
)

// TestCadencePerDay pins the accumulated-history cadence estimator: rate is
// count over the observed span (not the fixed window), thin history yields the
// rare floor (no boost), and the span is floored/capped.
func TestCadencePerDay(t *testing.T) {
	tests := []struct {
		name   string
		count  int
		span   float64
		window int
		want   float64
	}{
		{"no items", 0, 0, 45, cadenceRareFloor},
		{"below min items reads as not-rare", 2, 30, 45, cadenceRareFloor},
		{"dense recent burst floors the span", 15, 0.05, 45, 15}, // span floored to 1 day
		{"high volume over full window", 900, 45, 45, 20},        // 900/45
		{"rare source spread over window", 3, 40, 45, 3.0 / 40},  // 0.075/day -> boosted
		{"span capped at window", 100, 90, 45, 100.0 / 45},       // observed span > window clamped
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := cadencePerDay(tt.count, tt.span, tt.window)
			if diff := got - tt.want; diff > 1e-9 || diff < -1e-9 {
				t.Fatalf("cadencePerDay(%d, %v, %d) = %v, want %v", tt.count, tt.span, tt.window, got, tt.want)
			}
		})
	}
}

// TestCandidatesCadenceFromAccumulatedHistory is the end-to-end contract for #7:
// a high-volume source whose items are all recent must NOT read as rare, a
// genuinely infrequent source must, and thin history sits at the rare floor.
func TestCandidatesCadenceFromAccumulatedHistory(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()

	u, err := db.UpsertUserByUsername(ctx, "tester", "")
	if err != nil {
		t.Fatal(err)
	}
	mkSource := func(title, url string) int64 {
		s, err := db.CreateSource(ctx, &Source{UserID: u.ID, Title: title, FeedURL: url, State: "followed", Weight: 1})
		if err != nil {
			t.Fatal(err)
		}
		return s.ID
	}
	now := time.Now().UTC()
	mkItem := func(sid int64, ext string, ageHours float64) {
		it := &Item{SourceID: sid, ExternalID: ext, URL: "u", Title: ext,
			PublishedAt: now.Add(-time.Duration(ageHours * float64(time.Hour)))}
		if _, err := db.UpsertItem(ctx, it); err != nil {
			t.Fatal(err)
		}
	}

	// Dense: 20 items, all within the last ~2 days. Accumulated rate ~10/day.
	dense := mkSource("Dense", "http://dense")
	for i := 0; i < 20; i++ {
		mkItem(dense, "d-"+strconv.Itoa(i), float64(i)*2.4) // 0..~48h
	}
	// Rare: 4 items spread across the 45-day window (~0.1/day).
	rare := mkSource("Rare", "http://rare")
	for i, age := range []float64{10, 20, 30, 40} {
		mkItem(rare, "r-"+strconv.Itoa(i), age*24)
	}
	// Thin: 2 items -> below the min-items floor, no boost.
	thin := mkSource("Thin", "http://thin")
	mkItem(thin, "t-0", 5*24)
	mkItem(thin, "t-1", 20*24)

	pool, err := db.Candidates(ctx, u.ID, nil, 45, 500)
	if err != nil {
		t.Fatal(err)
	}
	cad := map[int64]float64{}
	for _, c := range pool {
		cad[c.SourceID] = c.SourceCadence
	}

	if cad[dense] < rareThresholdForTest {
		t.Fatalf("dense source read as rare: cadence=%v (want >= %v)", cad[dense], rareThresholdForTest)
	}
	if cad[rare] >= rareThresholdForTest {
		t.Fatalf("rare source not rare: cadence=%v (want < %v)", cad[rare], rareThresholdForTest)
	}
	if cad[thin] != cadenceRareFloor {
		t.Fatalf("thin history should sit at rare floor %v, got %v", cadenceRareFloor, cad[thin])
	}
}

// rareThresholdForTest mirrors session.rareThresholdPerDay (1.0/day); the store
// can't import session, so the boundary is duplicated for the assertion.
const rareThresholdForTest = 1.0
