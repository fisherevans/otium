package store

import "testing"

// TestCadencePerDay pins the accumulated-history cadence estimator: rate is count
// over the observed span (not the fixed window), the span is floored/capped, and
// there is no thin-history floor. Cadence is now informational only (engine v2
// dropped rarity, #114); it powers the posts/day figure.
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
