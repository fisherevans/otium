package youtube

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

func TestImportPage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/playlistItems":
			w.Write([]byte(`{"nextPageToken":"PAGE2","items":[
				{"snippet":{"title":"Old Talk","description":"line1\nline2","thumbnails":{"high":{"url":"th"}},"resourceId":{"videoId":"vid1"}},"contentDetails":{"videoId":"vid1","videoPublishedAt":"2018-03-04T05:06:07Z"}},
				{"snippet":{"title":"A Short","resourceId":{"videoId":"vid2"}},"contentDetails":{"videoId":"vid2","videoPublishedAt":"2019-01-01T00:00:00Z"}}
			]}`))
		case "/videos":
			w.Write([]byte(`{"items":[
				{"id":"vid1","contentDetails":{"duration":"PT12M"},"statistics":{"viewCount":"999"}},
				{"id":"vid2","contentDetails":{"duration":"PT30S"},"statistics":{"viewCount":"10"}}
			]}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()
	old := baseURL
	baseURL = srv.URL
	defer func() { baseURL = old }()

	db, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	u, _ := db.UpsertUserByUsername(ctx, "t", "")
	s, err := db.CreateSource(ctx, &store.Source{
		UserID: u.ID, Kind: "youtube", Title: "Chan", State: "followed", Weight: 1,
		FeedURL: "https://www.youtube.com/feeds/videos.xml?channel_id=UCabc",
	})
	if err != nil {
		t.Fatal(err)
	}

	res, err := NewClient("k").ImportPage(ctx, db, *s, "", time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Imported != 2 || res.Seen != 2 || res.NextPageToken != "PAGE2" {
		t.Fatalf("result = %+v", res)
	}

	// Re-running the same page must not duplicate (external-id dedupe).
	res2, err := NewClient("k").ImportPage(ctx, db, *s, "", time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if res2.Imported != 0 || res2.Seen != 2 {
		t.Fatalf("re-import should upsert 0 new, got %+v", res2)
	}

	// Verify the items landed with the RSS-matching external id, duration + bucket.
	cands, err := db.ItemsAfter(ctx, 0, 10)
	if err != nil || len(cands) != 2 {
		t.Fatalf("ItemsAfter: %v (n=%d)", err, len(cands))
	}
	byURL := map[string]store.EnrichCandidate{}
	for _, c := range cands {
		byURL[c.URL] = c
	}
	v1 := byURL["https://www.youtube.com/watch?v=vid1"]
	if v1.DurationSec != 720 || v1.MediaType != "long" {
		t.Fatalf("vid1 = %+v", v1)
	}
	v2 := byURL["https://www.youtube.com/watch?v=vid2"]
	if v2.DurationSec != 30 || v2.MediaType != "short" {
		t.Fatalf("vid2 (should be short) = %+v", v2)
	}
}

// TestImportPageCutoff: a video older than the cutoff is skipped and flags
// ReachedCutoff (stop paging), while a newer one is imported.
func TestImportPageCutoff(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/playlistItems":
			w.Write([]byte(`{"nextPageToken":"MORE","items":[
				{"snippet":{"title":"Recent","resourceId":{"videoId":"new"}},"contentDetails":{"videoId":"new","videoPublishedAt":"2026-06-01T00:00:00Z"}},
				{"snippet":{"title":"Ancient","resourceId":{"videoId":"old"}},"contentDetails":{"videoId":"old","videoPublishedAt":"2010-01-01T00:00:00Z"}}
			]}`))
		case "/videos":
			w.Write([]byte(`{"items":[{"id":"new","contentDetails":{"duration":"PT5M"}}]}`))
		}
	}))
	defer srv.Close()
	old := baseURL
	baseURL = srv.URL
	defer func() { baseURL = old }()

	db, _ := store.Open(":memory:")
	defer db.Close()
	ctx := context.Background()
	u, _ := db.UpsertUserByUsername(ctx, "t", "")
	s, _ := db.CreateSource(ctx, &store.Source{UserID: u.ID, Kind: "youtube", Title: "C", State: "followed", Weight: 1,
		FeedURL: "https://www.youtube.com/feeds/videos.xml?channel_id=UCz"})

	cutoff := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	res, err := NewClient("k").ImportPage(ctx, db, *s, "", cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if res.Imported != 1 || !res.ReachedCutoff {
		t.Fatalf("expected 1 imported + cutoff, got %+v", res)
	}
}
