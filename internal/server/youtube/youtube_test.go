package youtube

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHelpers(t *testing.T) {
	if got := ChannelIDFromFeedURL("https://www.youtube.com/feeds/videos.xml?channel_id=UCabc123"); got != "UCabc123" {
		t.Fatalf("channel id = %q", got)
	}
	if got := ChannelIDFromFeedURL("http://example.com/rss.xml"); got != "" {
		t.Fatalf("non-youtube should be empty, got %q", got)
	}
	if got := UploadsPlaylistID("UCabc123"); got != "UUabc123" {
		t.Fatalf("uploads playlist = %q", got)
	}
	cases := map[string]int{"PT1M10S": 70, "PT1H2M3S": 3723, "PT45S": 45, "PT2H": 7200, "": 0, "P1D": 0}
	for in, want := range cases {
		if got := ParseISODuration(in); got != want {
			t.Fatalf("ParseISODuration(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestListAndFill(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/playlistItems":
			if r.URL.Query().Get("key") != "k" || r.URL.Query().Get("playlistId") != "UUx" {
				t.Errorf("bad playlistItems params: %s", r.URL.RawQuery)
			}
			w.Write([]byte(`{"nextPageToken":"NEXT","items":[
				{"snippet":{"title":"First","description":"d1","thumbnails":{"high":{"url":"t1"}},"resourceId":{"videoId":"v1"}},"contentDetails":{"videoId":"v1","videoPublishedAt":"2020-01-02T03:04:05Z"}},
				{"snippet":{"title":"Private video","resourceId":{"videoId":"v2"}},"contentDetails":{"videoId":"v2"}},
				{"snippet":{"title":"Second","resourceId":{"videoId":"v3"}},"contentDetails":{"videoId":"v3","videoPublishedAt":"2021-05-06T00:00:00Z"}}
			]}`))
		case r.URL.Path == "/videos":
			w.Write([]byte(`{"items":[
				{"id":"v1","contentDetails":{"duration":"PT1M10S"},"statistics":{"viewCount":"1000","likeCount":"42"}},
				{"id":"v3","contentDetails":{"duration":"PT2H"},"statistics":{"viewCount":"5","likeCount":"1"}}
			]}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()
	old := baseURL
	baseURL = srv.URL
	defer func() { baseURL = old }()

	c := NewClient("k")
	vids, next, err := c.ListUploadsPage(context.Background(), "UUx", "")
	if err != nil {
		t.Fatal(err)
	}
	if next != "NEXT" {
		t.Fatalf("next = %q", next)
	}
	if len(vids) != 2 { // private video dropped
		t.Fatalf("got %d videos, want 2", len(vids))
	}
	if vids[0].ID != "v1" || vids[0].Title != "First" || vids[0].ThumbnailURL != "t1" {
		t.Fatalf("v1 = %+v", vids[0])
	}
	if vids[0].PublishedAt.Year() != 2020 {
		t.Fatalf("v1 pub = %v", vids[0].PublishedAt)
	}

	if err := c.FillDetails(context.Background(), vids); err != nil {
		t.Fatal(err)
	}
	if vids[0].DurationSec != 70 || vids[0].ViewCount != 1000 || vids[0].LikeCount != 42 {
		t.Fatalf("v1 details = %+v", vids[0])
	}
	if vids[1].DurationSec != 7200 || vids[1].ViewCount != 5 {
		t.Fatalf("v3 details = %+v", vids[1])
	}
}

func TestTransientOn403(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"quotaExceeded"}`))
	}))
	defer srv.Close()
	old := baseURL
	baseURL = srv.URL
	defer func() { baseURL = old }()

	_, _, err := NewClient("k").ListUploadsPage(context.Background(), "UUx", "")
	if _, ok := err.(*TransientError); !ok {
		t.Fatalf("403 should be transient, got %T: %v", err, err)
	}
}
