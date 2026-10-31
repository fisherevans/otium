package enrich

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

func TestVideoIDFromURL(t *testing.T) {
	tests := []struct {
		name, in, want string
	}{
		{"watch", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"watch extra params", "https://www.youtube.com/watch?v=abc123&t=30s", "abc123"},
		{"youtu.be", "https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"shorts", "https://www.youtube.com/shorts/xyz789", "xyz789"},
		{"no id", "https://www.youtube.com/", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := videoIDFromURL(tt.in); got != tt.want {
				t.Errorf("videoIDFromURL(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestYouTubeDurationBackendsPreserveClassificationEvidence(t *testing.T) {
	tests := []struct {
		name, path, kind string
		seconds          int
		knownAspect      float64
		apiAspect        float64
		want             string
	}{
		{"explicit 180 seconds", "/shorts/x", "short", 180, 0, 0, "short"},
		{"known vertical 95 seconds", "/watch?v=x", "long", 95, 0.5625, 0, "short"},
		{"unknown 95 seconds", "/watch?v=x", "long", 95, 0, 0, "long"},
		{"legacy short", "/watch?v=x", "long", 90, 0, 0, "short"},
		{"live", "/watch?v=x", "live", 30, 0, 0, "live"},
	}
	for _, backend := range []string{"scrape", "api metadata"} {
		for _, tt := range tests {
			t.Run(backend+"/"+tt.name, func(t *testing.T) {
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					fmt.Fprintf(w, `{"lengthSeconds":"%d"}`, tt.seconds)
				}))
				defer srv.Close()
				db, err := store.Open(":memory:")
				if err != nil {
					t.Fatal(err)
				}
				defer db.Close()
				ctx := context.Background()
				u, err := db.UpsertUserByUsername(ctx, "test", "")
				if err != nil {
					t.Fatal(err)
				}
				s, err := db.CreateSource(ctx, &store.Source{UserID: u.ID, Kind: "youtube", FeedURL: srv.URL, Title: "Videos", State: "followed", Weight: 1})
				if err != nil {
					t.Fatal(err)
				}
				if _, err := db.UpsertYouTubeItem(ctx, &store.Item{SourceID: s.ID, ExternalID: "x", URL: srv.URL + tt.path,
					MediaType: tt.kind, AspectRatio: tt.knownAspect, PublishedAt: time.Now()}); err != nil {
					t.Fatal(err)
				}
				cands, err := db.ItemsAfter(ctx, 0, 1)
				if err != nil || len(cands) != 1 {
					t.Fatalf("seed: %+v, %v", cands, err)
				}
				c := cands[0]
				y := NewYouTube(slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
				if backend == "scrape" {
					_, err = y.enrichScrape(ctx, db, c)
				} else {
					_, err = y.commitDuration(ctx, db, c.ID, tt.seconds, tt.apiAspect)
				}
				if err != nil {
					t.Fatal(err)
				}
				got, _, err := db.EnrichCandidateByID(ctx, c.ID)
				if err != nil || got.MediaType != tt.want || got.DurationSec != tt.seconds {
					t.Fatalf("enriched: %+v, %v; want %s, %ds", got, err, tt.want, tt.seconds)
				}
				if tt.knownAspect > 0 && got.AspectRatio != tt.knownAspect {
					t.Fatalf("lost known aspect: got %v, want %v", got.AspectRatio, tt.knownAspect)
				}
			})
		}
	}
}
