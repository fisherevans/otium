package store

import (
	"context"
	"strconv"
	"testing"
	"time"
)

// TestCadencePerDay pins the accumulated-history cadence estimator: rate is
// count over the observed span (not the fixed window), the span is floored/capped,
// and there is no thin-history floor (#110) - a source we've seen little of reads
// at its actual low rate so it ranks as rare among the user's sources.
func TestCadencePerDay(t *testing.T) {
	tests := []struct {
		name   string
		count  int
		span   float64
		window int
		want   float64
	}{
		{"no items reads as zero", 0, 0, 45, 0},
		{"thin history reads at actual low rate", 2, 30, 45, 2.0 / 30},
		{"dense recent burst floors the span", 15, 0.05, 45, 15}, // span floored to 1 day
		{"high volume over full window", 900, 45, 45, 20},        // 900/45
		{"rare source spread over window", 3, 40, 45, 3.0 / 40},  // 0.075/day
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

// TestRarityBoosts pins the population-relative rarity (#110): the rarest source
// gets the full lift (1+rareBoostMax), the most frequent gets none (1), and a
// mid-cadence source lands strictly between. Different real rates always separate,
// which is the property the old absolute threshold lost on a young library.
func TestRarityBoosts(t *testing.T) {
	cad := map[int64]float64{
		1: 5.0,  // most frequent
		2: 1.0,  //
		3: 0.2,  //
		4: 0.02, // rarest
	}
	b := rarityBoosts(cad)
	if b[1] != 1.0 {
		t.Fatalf("most frequent should get no boost, got %v", b[1])
	}
	if b[4] != 1+rareBoostMax {
		t.Fatalf("rarest should get full boost %v, got %v", 1+rareBoostMax, b[4])
	}
	// Monotonic: rarer -> larger boost, and all four distinct.
	if !(b[4] > b[3] && b[3] > b[2] && b[2] > b[1]) {
		t.Fatalf("boosts must increase with rarity: %v %v %v %v", b[1], b[2], b[3], b[4])
	}
}

// TestRarityBoostsTiesShareRank verifies identical cadences get identical boosts.
func TestRarityBoostsTiesShareRank(t *testing.T) {
	cad := map[int64]float64{1: 1.0, 2: 1.0, 3: 0.1}
	b := rarityBoosts(cad)
	if b[1] != b[2] {
		t.Fatalf("tied cadences should share a boost: %v vs %v", b[1], b[2])
	}
	if !(b[3] > b[1]) {
		t.Fatalf("the rarer source should out-boost the tied pair: %v vs %v", b[3], b[1])
	}
}

// TestCandidatesRarityFromAccumulatedHistory is the end-to-end contract: a
// high-volume source whose items are all recent must NOT read as rare, and a
// genuinely infrequent source must out-rank it on the relative rarity boost that
// the store overlays onto candidates (#7 + #110).
func TestCandidatesRarityFromAccumulatedHistory(t *testing.T) {
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

	pool, err := db.Candidates(ctx, u.ID, nil, 45, 500)
	if err != nil {
		t.Fatal(err)
	}
	boost := map[int64]float64{}
	cad := map[int64]float64{}
	for _, c := range pool {
		boost[c.SourceID] = c.RarityBoost
		cad[c.SourceID] = c.SourceCadence
	}

	if cad[dense] <= cad[rare] {
		t.Fatalf("dense cadence %v should exceed rare cadence %v", cad[dense], cad[rare])
	}
	if !(boost[rare] > boost[dense]) {
		t.Fatalf("rare source should get a larger rarity boost: rare=%v dense=%v", boost[rare], boost[dense])
	}
	if boost[dense] != 1.0 {
		t.Fatalf("the most frequent source should get no boost, got %v", boost[dense])
	}
}
