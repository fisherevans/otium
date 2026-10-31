package feeds

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/mmcdole/gofeed"

	"github.com/fisherevans/otium/internal/server/store"
	"github.com/fisherevans/otium/internal/server/youtube"
)

func TestClassifyVideoWithoutGeometry(t *testing.T) {
	tests := []struct {
		name, kind, url string
		seconds         int
		want            string
	}{
		{"unknown", "youtube", "https://youtube.com/watch?v=x", 0, "long"},
		{"legacy short", "youtube", "https://youtube.com/watch?v=x", 90, "short"},
		{"no inferred geometry", "youtube", "https://youtube.com/watch?v=x", 95, "long"},
		{"explicit", "youtube", "https://youtube.com/shorts/x", 180, "short"},
		{"podcast unchanged", "podcast", "https://example.com/shorts/x", 60, "audio"},
		{"article unchanged", "rss", "https://example.com/x", 60, "article"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := classify(store.Source{Kind: tt.kind}, &gofeed.Item{Link: tt.url}, tt.seconds); got != tt.want {
				t.Fatalf("classify() = %q, want %q", got, tt.want)
			}
		})
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestFetchAllDue(t *testing.T) {
	tests := []struct {
		name   string
		minAge time.Duration
		manual bool
		cancel bool
	}{
		{"scheduled", 2 * time.Hour, false, false},
		{"zero preserves old schedule", 0, false, false},
		{"manual forces refresh", 2 * time.Hour, true, false},
		{"cancellation stops batch", 0, false, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var mu sync.Mutex
			calls := map[string]int{}
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				key := r.URL.Path
				if key == "/youtube/v3/playlistItems" {
					key += "/" + r.URL.Query().Get("playlistId")
				} else if key == "/youtube/v3/videos" {
					key += "/" + r.URL.Query().Get("id")
				}
				mu.Lock()
				calls[key]++
				mu.Unlock()
				if tt.cancel {
					cancel()
				}
				switch r.URL.Path {
				case "/rss":
					w.Header().Set("Content-Type", "application/rss+xml")
					fmt.Fprint(w, `<rss version="2.0"><channel><title>RSS</title><link>https://example.com</link><description>Fixture</description></channel></rss>`)
				case "/youtube/v3/playlistItems":
					id := r.URL.Query().Get("playlistId")
					fmt.Fprintf(w, `{"items":[{"snippet":{"title":"Fixture"},"contentDetails":{"videoId":%q,"videoPublishedAt":"2026-10-31T00:00:00Z"}}]}`, id)
				case "/youtube/v3/videos":
					id := r.URL.Query().Get("id")
					fmt.Fprintf(w, `{"items":[{"id":%q,"contentDetails":{"duration":"PT60S"}}]}`, id)
				default:
					http.NotFound(w, r)
				}
			}))
			defer srv.Close()
			endpoint, err := url.Parse(srv.URL)
			if err != nil {
				t.Fatal(err)
			}
			transport := http.DefaultTransport
			http.DefaultTransport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host == "www.googleapis.com" {
					r = r.Clone(r.Context())
					r.URL.Scheme, r.URL.Host = endpoint.Scheme, endpoint.Host
				}
				return transport.RoundTrip(r)
			})
			defer func() { http.DefaultTransport = transport }()

			path := filepath.Join(t.TempDir(), "ingest.db")
			db, err := store.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			u, err := db.UpsertUserByUsername(ctx, "test", "")
			if err != nil {
				t.Fatal(err)
			}
			seed, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer seed.Close()
			for _, spec := range []struct {
				name, kind, feed string
				age              time.Duration
			}{
				{"rss", "rss", srv.URL + "/rss", time.Minute},
				{"old", "youtube", youtube.CanonicalFeedURL("UCold"), 3 * time.Hour},
				{"new", "youtube", youtube.CanonicalFeedURL("UCnew"), 0},
				{"recent", "youtube", youtube.CanonicalFeedURL("UCrecent"), time.Minute},
			} {
				s, err := db.CreateSource(ctx, &store.Source{UserID: u.ID, Kind: spec.kind, Title: spec.name, FeedURL: spec.feed, State: "followed", Weight: 1})
				if err != nil {
					t.Fatal(err)
				}
				if spec.age > 0 {
					if _, err := seed.Exec(`UPDATE sources SET last_fetch_at=? WHERE id=?`, time.Now().Add(-spec.age).UTC().Format("2006-01-02 15:04:05"), s.ID); err != nil {
						t.Fatal(err)
					}
				}
			}
			ing := NewIngester(db, slog.New(slog.NewTextHandler(io.Discard, nil)))
			ing.SetYouTube(youtube.NewClient("fixture"))
			var fresh int
			if tt.manual {
				fresh, err = ing.FetchAll(ctx, u.ID)
			} else {
				fresh, err = ing.FetchAllDue(ctx, u.ID, tt.minAge)
			}
			mu.Lock()
			defer mu.Unlock()
			if tt.cancel {
				total := 0
				for _, n := range calls {
					total += n
				}
				if !errors.Is(err, context.Canceled) || total != 1 {
					t.Fatalf("canceled batch: requests=%d, err=%v", total, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			want := map[string]int{
				"/rss":                            1,
				"/youtube/v3/playlistItems/UUold": 1,
				"/youtube/v3/videos/UUold":        1,
				"/youtube/v3/playlistItems/UUnew": 1,
				"/youtube/v3/videos/UUnew":        1,
			}
			wantFresh := 2
			if tt.manual || tt.minAge == 0 {
				want["/youtube/v3/playlistItems/UUrecent"] = 1
				want["/youtube/v3/videos/UUrecent"] = 1
				wantFresh++
			}
			gotJSON, _ := json.Marshal(calls)
			wantJSON, _ := json.Marshal(want)
			if string(gotJSON) != string(wantJSON) || fresh != wantFresh {
				t.Fatalf("requests=%s, fresh=%d; want requests=%s, fresh=%d", gotJSON, fresh, wantJSON, wantFresh)
			}
		})
	}
}
