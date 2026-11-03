package handler

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/fisherevans/otium/internal/server/store"
)

func TestNormalizePreset(t *testing.T) {
	tests := []struct {
		name      string
		setup     string
		wantErr   string
		wantTypes []string
	}{
		{"plain preset", `{"minutes":10,"sections":["news"],"excluded":[],"contentTypes":["article"]}`, "", []string{"article"}},
		{"mix derives content types and drops scope", `{"minutes":30,"sections":["news"],"excluded":["x"],"contentTypes":[],"mix":{"formats":{"post":10,"short":20},"sections":{"news":2}}}`, "", []string{"article", "short"}},
		{"minutes out of range", `{"minutes":2,"contentTypes":["article"]}`, "minutes", nil},
		{"unknown content type", `{"minutes":10,"contentTypes":["podcast"]}`, "content type", nil},
		{"mix with no shares", `{"minutes":10,"mix":{"formats":{"article":0},"sections":{}}}`, "at least one format", nil},
		{"bad section weight", `{"minutes":10,"mix":{"formats":{"article":1},"sections":{"news":3}}}`, "weight", nil},
		{"unknown mix format", `{"minutes":10,"mix":{"formats":{"tweets":1},"sections":{}}}`, "mix format", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizePreset(store.SessionPreset{ID: "p", Name: "P", Setup: json.RawMessage(tt.setup)})
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var s presetSetup
			_ = json.Unmarshal(got.Setup, &s)
			if strings.Join(s.ContentTypes, ",") != strings.Join(tt.wantTypes, ",") {
				t.Fatalf("content types = %v, want %v", s.ContentTypes, tt.wantTypes)
			}
			if s.Mix != nil && (len(s.Sections) != 0 || len(s.Excluded) != 0) {
				t.Fatalf("a mix must not keep scope: %+v", s)
			}
		})
	}
}
