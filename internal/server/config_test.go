package server

import "testing"

func TestYouTubeFetchIntervalConfig(t *testing.T) {
	t.Setenv("OTIUM_DEV_USER", "test")
	t.Setenv("OTIUM_OIDC_ISSUER", "")
	t.Setenv("PORT", "")
	t.Setenv("OTIUM_FETCH_INTERVAL_MIN", "")
	tests := []struct {
		name, value string
		want        int
		wantErr     bool
	}{
		{"default", "", 0, false},
		{"disabled", "0", 0, false},
		{"two hours", "120", 120, false},
		{"negative", "-1", 0, true},
		{"invalid", "later", 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("OTIUM_YOUTUBE_FETCH_INTERVAL_MIN", tt.value)
			cfg, err := LoadConfig()
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected invalid interval error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if cfg.YouTubeFetchIntervalMin != tt.want || cfg.FetchIntervalMin != 30 {
				t.Fatalf("intervals: YouTube=%d, loop=%d", cfg.YouTubeFetchIntervalMin, cfg.FetchIntervalMin)
			}
		})
	}
}
