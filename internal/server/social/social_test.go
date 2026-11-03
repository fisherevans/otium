package social

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseBskyInput(t *testing.T) {
	tests := []struct{ in, want string }{
		{"@pfrazee.com", "pfrazee.com"},
		{"jay", "jay.bsky.social"},
		{"https://bsky.app/profile/alice.bsky.social", "alice.bsky.social"},
		{"https://bsky.app/profile/alice.bsky.social/post/3abc", "alice.bsky.social"},
		{"did:plc:abc123", "did:plc:abc123"},
		{"https://example.com/foo", ""},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := ParseBskyInput(tt.in); got != tt.want {
				t.Fatalf("ParseBskyInput(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestSubstackHost(t *testing.T) {
	tests := []struct{ in, want string }{
		{"astralcodexten", "astralcodexten.substack.com"},
		{"https://www.astralcodexten.com/p/open-thread", "www.astralcodexten.com"},
		{"noahpinion.substack.com", "noahpinion.substack.com"},
		{"https://substack.com/@noahpinion", "noahpinion.substack.com"},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := SubstackHost(tt.in); got != tt.want {
				t.Fatalf("SubstackHost(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestMediumFeedURL(t *testing.T) {
	tests := []struct{ in, want string }{
		{"@ev", "https://medium.com/feed/@ev"},
		{"https://medium.com/@ev", "https://medium.com/feed/@ev"},
		{"https://medium.com/the-atlantic/some-post-123", "https://medium.com/feed/the-atlantic"},
		{"https://ev.medium.com/", "https://ev.medium.com/feed"},
		{"https://medium.com/feed/@ev", "https://medium.com/feed/@ev"},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := MediumFeedURL(tt.in); got != tt.want {
				t.Fatalf("MediumFeedURL(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestBskyToPost(t *testing.T) {
	raw := `{"uri":"at://did:plc:x/app.bsky.feed.post/3abc","author":{"handle":"a.bsky.social","displayName":"Al"},
	  "record":{"text":"Look at this <cool> thing\nsecond line","createdAt":"2026-11-02T18:32:15.017Z"},
	  "embed":{"$type":"app.bsky.embed.images#view","images":[{"thumb":"https://t/1","fullsize":"https://f/1","alt":"a pic"}]},
	  "likeCount":5,"repostCount":2,"replyCount":1,"quoteCount":1}`
	var p bskyPost
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatal(err)
	}
	got, ok := bskyToPost(p)
	if !ok {
		t.Fatal("not converted")
	}
	if got.URL != "https://bsky.app/profile/a.bsky.social/post/3abc" {
		t.Errorf("url = %q", got.URL)
	}
	if got.Title != "Look at this <cool> thing" {
		t.Errorf("title = %q", got.Title)
	}
	if got.ThumbnailURL != "https://t/1" {
		t.Errorf("thumb = %q", got.ThumbnailURL)
	}
	if strings.Contains(got.ContentHTML, "<cool>") || !strings.Contains(got.ContentHTML, "&lt;cool&gt;") {
		t.Errorf("post text not escaped: %q", got.ContentHTML)
	}
	if got.Engagement != (Engagement{Likes: 5, Reposts: 3, Replies: 1}) {
		t.Errorf("engagement = %+v", got.Engagement)
	}
}

func TestPostRemainder(t *testing.T) {
	tests := []struct{ name, text, want string }{
		{"one line shows once", "Okay joined the club", ""},
		{"second line is the summary", "Headline here\nand the rest of it", "and the rest of it"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := postRemainder(tt.text, PostTitle(tt.text)); got != tt.want {
				t.Fatalf("postRemainder = %q, want %q", got, tt.want)
			}
		})
	}
}
