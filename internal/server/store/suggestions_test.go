package store

import (
	"context"
	"testing"
)

func TestSuggestionsLifecycle(t *testing.T) {
	ctx := context.Background()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	u, _ := db.UpsertUserByUsername(ctx, "fisher", "")
	src, err := db.CreateSource(ctx, &Source{UserID: u.ID, Kind: "rss", Title: "Followed", FeedURL: "https://a.test/feed"})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		feed string
		want bool
	}{
		{"followed source is known", "https://a.test/feed", true},
		{"new feed is unknown", "https://b.test/feed", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := db.KnownFeed(ctx, u.ID, tt.feed)
			if err != nil || got != tt.want {
				t.Fatalf("KnownFeed(%q) = %v, %v; want %v", tt.feed, got, err, tt.want)
			}
		})
	}

	id, err := db.InsertSuggestion(ctx, u.ID, &Suggestion{Kind: "bluesky", FeedURL: "bsky:did:x", Title: "X", Reason: "because", Confidence: 0.9})
	if err != nil {
		t.Fatal(err)
	}
	if known, _ := db.KnownFeed(ctx, u.ID, "bsky:did:x"); !known {
		t.Fatal("a suggested feed must count as known so it is never re-offered")
	}
	sid := src.ID
	if err := db.SetSuggestionStatus(ctx, u.ID, id, "trial", &sid); err != nil {
		t.Fatal(err)
	}
	got, err := db.ListSuggestions(ctx, u.ID, "trial")
	if err != nil || len(got) != 1 || got[0].SourceID != src.ID || got[0].Reason != "because" {
		t.Fatalf("trial list = %+v, %v", got, err)
	}
	if pending, _ := db.ListSuggestions(ctx, u.ID, "pending"); len(pending) != 0 {
		t.Fatalf("pending should be empty, got %d", len(pending))
	}
	eng, err := db.EngagementBySource(ctx, u.ID, 90)
	if err != nil || len(eng) != 1 || eng[0].Title != "Followed" {
		t.Fatalf("engagement = %+v, %v", eng, err)
	}
}
