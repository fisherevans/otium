package media

import "testing"

func TestVideoType(t *testing.T) {
	tests := []struct {
		name, current, url string
		seconds            int
		aspect             float64
		want               string
	}{
		{"unknown", "", "", 0, 0, "long"},
		{"unknown duration vertical", "long", "", 0, 0.5625, "long"},
		{"negative duration", "long", "", -1, 0.5625, "long"},
		{"legacy landscape boundary", "long", "", 90, 1.778, "short"},
		{"legacy unknown geometry", "long", "", 90, 0, "short"},
		{"over legacy unknown geometry", "long", "", 91, 0, "long"},
		{"over legacy landscape", "long", "", 91, 1.778, "long"},
		{"adrian vertical clip", "long", "", 95, 0.5625, "short"},
		{"square boundary", "long", "", 180, 1, "short"},
		{"just wider than square", "long", "", 180, 1.001, "long"},
		{"over three minutes", "short", "", 181, 0.5625, "long"},
		{"negative aspect", "long", "", 180, -1, "long"},
		{"explicit without metadata", "long", "https://youtube.com/shorts/abc", 0, 0, "short"},
		{"explicit survives conflicting metadata", "short", "https://youtube.com/shorts/abc", 181, 1.778, "short"},
		{"existing short missing duration", "short", "", 0, 0, "short"},
		{"live wins over explicit and metadata", "live", "https://youtube.com/shorts/abc", 30, 0.5625, "live"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := VideoType(tt.current, tt.url, tt.seconds, tt.aspect); got != tt.want {
				t.Fatalf("VideoType() = %q, want %q", got, tt.want)
			}
		})
	}
}
