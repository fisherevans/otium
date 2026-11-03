package conversation

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestPlatformOf(t *testing.T) {
	tests := []struct {
		name string
		t    Target
		want string
	}{
		{"bluesky post", Target{Kind: "bluesky", ExternalID: "at://did:plc:x/app.bsky.feed.post/3abc"}, Bluesky},
		{"bluesky without uri", Target{Kind: "bluesky", ExternalID: "x"}, ""},
		{"substack kind", Target{Kind: "substack", URL: "https://www.astralcodexten.com/p/open-thread"}, Substack},
		{"substack rss host", Target{Kind: "rss", FeedURL: "https://noahpinion.substack.com/feed", URL: "https://www.noahpinion.blog/p/x"}, Substack},
		{"substack non-post", Target{Kind: "substack", URL: "https://x.substack.com/about"}, ""},
		{"youtube watch", Target{Kind: "youtube", URL: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}, YouTube},
		{"youtube short", Target{Kind: "youtube", URL: "https://www.youtube.com/shorts/dQw4w9WgXcQ"}, YouTube},
		{"plain article", Target{Kind: "rss", URL: "https://example.com/p/thing"}, ""},
		{"medium", Target{Kind: "medium", URL: "https://medium.com/@ev/post-123"}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := PlatformOf(tt.t); got != tt.want {
				t.Fatalf("PlatformOf = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestYouTubeVideoID(t *testing.T) {
	tests := []struct{ in, want string }{
		{"https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://m.youtube.com/shorts/dQw4w9WgXcQ?feature=share", "dQw4w9WgXcQ"},
		{"https://www.youtube.com/watch?v=short", ""},
		{"https://vimeo.com/123", ""},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := YouTubeVideoID(tt.in); got != tt.want {
				t.Fatalf("YouTubeVideoID(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

const bskyThread = `{"thread":{"$type":"app.bsky.feed.defs#threadViewPost",
 "post":{"uri":"at://did:plc:a/app.bsky.feed.post/3root","author":{"handle":"alice.bsky.social","displayName":"Alice"},
  "record":{"text":"root","createdAt":"2026-11-02T10:00:00Z"},
  "likeCount":183,"repostCount":11,"replyCount":3,"quoteCount":1,
  "embed":{"$type":"app.bsky.embed.recordWithMedia#view",
   "media":{"$type":"app.bsky.embed.images#view","images":[{"thumb":"t"}]},
   "record":{"record":{"$type":"app.bsky.embed.record#viewRecord","uri":"at://did:plc:c/app.bsky.feed.post/3q",
    "author":{"handle":"carol.test","displayName":""},"value":{"text":"the quoted post <b>","createdAt":"2026-11-01T00:00:00Z"},"likeCount":7}}}},
 "replies":[
  {"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"at://did:plc:b/app.bsky.feed.post/3r1","author":{"handle":"bob.test","displayName":"Bob"},
   "record":{"text":"meh","createdAt":"2026-11-02T11:00:00Z"},"likeCount":1}},
  {"$type":"app.bsky.feed.defs#notFoundPost","uri":"at://gone"},
  {"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"at://did:plc:d/app.bsky.feed.post/3r2","author":{"handle":"dee.test","displayName":"Dee"},
   "record":{"text":"<script>alert(1)</script> great","createdAt":"2026-11-02T12:00:00Z"},"likeCount":40,"replyCount":2,
   "embed":{"$type":"app.bsky.embed.external#view","external":{"uri":"https://x"}}},
   "replies":[
    {"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"at://did:plc:g/app.bsky.feed.post/3c1","author":{"handle":"gus.test"},
     "record":{"text":"meh too","createdAt":"2026-11-02T12:30:00Z"},"likeCount":1}},
    {"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"at://did:plc:h/app.bsky.feed.post/3c2","author":{"handle":"hal.test","displayName":"Hal"},
     "record":{"text":"\u2019 see x.test/a...","createdAt":"2026-11-02T12:40:00Z",
      "facets":[{"index":{"byteStart":8,"byteEnd":19},"features":[{"$type":"app.bsky.richtext.facet#link","uri":"https://x.test/a/full"}]}]},"likeCount":5},
     "replies":[{"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"at://did:plc:a/app.bsky.feed.post/3c3","author":{"handle":"alice.bsky.social"},
      "record":{"text":"deep","createdAt":"2026-11-02T12:50:00Z"},"likeCount":0}}]}
   ]}
 ]}}`

const bskyQuotes = `{"uri":"at://did:plc:a/app.bsky.feed.post/3root","posts":[
 {"uri":"at://did:plc:e/app.bsky.feed.post/3qa","author":{"handle":"eve.test"},"record":{"text":"low","createdAt":"2026-11-02T13:00:00Z"},"likeCount":0},
 {"uri":"at://did:plc:f/app.bsky.feed.post/3qb","author":{"handle":"fay.test","displayName":"Fay"},"record":{"text":"high","createdAt":"2026-11-02T14:00:00Z"},"likeCount":9}]}`

func TestBluesky(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Query().Get("uri") != "at://did:plc:a/app.bsky.feed.post/3root" {
			t.Errorf("uri = %q", r.URL.Query().Get("uri"))
		}
		switch r.URL.Path {
		case "/app.bsky.feed.getPostThread":
			_, _ = w.Write([]byte(bskyThread))
		case "/app.bsky.feed.getQuotes":
			_, _ = w.Write([]byte(bskyQuotes))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	s := New(Config{BskyBase: srv.URL})
	target := Target{Kind: "bluesky", ExternalID: "at://did:plc:a/app.bsky.feed.post/3root"}
	c, err := s.Get(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	if c.Platform != Bluesky || c.URL != "https://bsky.app/profile/alice.bsky.social/post/3root" {
		t.Fatalf("platform/url = %q %q", c.Platform, c.URL)
	}
	if c.Counts != (Counts{Likes: 183, Reposts: 11, Replies: 3, Quotes: 1}) {
		t.Fatalf("counts = %+v", c.Counts)
	}
	if len(c.Replies) != 2 || c.Replies[0].Author != "Dee" || c.Replies[1].Author != "Bob" {
		t.Fatalf("replies not most-liked first: %+v", c.Replies)
	}
	// Remote text stays raw text; the client renders it as text, never HTML.
	if c.Replies[0].Text != "<script>alert(1)</script> great" || c.Replies[0].Media != "link" {
		t.Fatalf("reply 0 = %+v", c.Replies[0])
	}
	// #207: replies nest, most-liked first at every level, with their links.
	kids := c.Replies[0].Children
	if len(kids) != 2 || kids[0].Author != "Hal" || kids[1].Author != "gus.test" || len(c.Replies[1].Children) != 0 {
		t.Fatalf("children = %+v", kids)
	}
	if len(kids[0].Children) != 1 || kids[0].Children[0].Text != "deep" {
		t.Fatalf("grandchildren = %+v", kids[0].Children)
	}
	if segs := kids[0].Segments; len(segs) != 2 || segs[1].Text != "x.test/a..." || segs[1].Href != "https://x.test/a/full" {
		t.Fatalf("child segments = %+v", segs)
	}
	if c.Replies[0].Segments != nil {
		t.Fatalf("a reply without links should carry no segments: %+v", c.Replies[0].Segments)
	}
	if c.Replies[0].URL != "https://bsky.app/profile/dee.test/post/3r2" {
		t.Fatalf("reply url = %q", c.Replies[0].URL)
	}
	if len(c.Quotes) != 2 || c.Quotes[0].Author != "Fay" || c.Quotes[1].Author != "eve.test" {
		t.Fatalf("quotes = %+v", c.Quotes)
	}
	if c.Quoted == nil || c.Quoted.Author != "carol.test" || c.Quoted.Likes != 7 || c.Quoted.URL != "https://bsky.app/profile/carol.test/post/3q" {
		t.Fatalf("quoted = %+v", c.Quoted)
	}
	// Second read is the cache.
	before := hits.Load()
	if _, err := s.Get(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	if hits.Load() != before {
		t.Fatalf("second Get hit the network")
	}
	// After the TTL it refetches.
	s.now = func() time.Time { return time.Now().Add(11 * time.Minute) }
	if _, err := s.Get(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	if hits.Load() == before {
		t.Fatalf("expired entry was not refetched")
	}
}

func TestBlueskyQuotesFailStillReturnsReplies(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/app.bsky.feed.getQuotes" {
			http.Error(w, "nope", http.StatusInternalServerError)
			return
		}
		_, _ = w.Write([]byte(bskyThread))
	}))
	defer srv.Close()
	c, err := New(Config{BskyBase: srv.URL}).Get(context.Background(), Target{Kind: "bluesky", ExternalID: "at://did:plc:a/app.bsky.feed.post/3root"})
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Replies) != 2 || len(c.Quotes) != 0 || c.Quotes == nil {
		t.Fatalf("replies=%d quotes=%v", len(c.Replies), c.Quotes)
	}
}

func TestSubstack(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/posts/your-book-review":
			_, _ = w.Write([]byte(`{"id":212349565,"reaction_count":83,"comment_count":61,"restacks":3}`))
		case "/api/v1/post/212349565/comments":
			if r.URL.Query().Get("sort") != "best_first" {
				t.Errorf("sort = %q", r.URL.Query().Get("sort"))
			}
			_, _ = w.Write([]byte(`{"comments":[
			 {"id":1,"name":"drosophilist","body":"two","reaction_count":2,"children_count":1,"date":"2026-10-30T18:28:00.149Z"},
			 {"id":2,"name":"","handle":"gone","body":null,"deleted":true,"reaction_count":50},
			 {"id":3,"name":"SMK","body":"four","reaction_count":4,"children_count":0,"date":"2026-10-31T09:53:23.628Z"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	s := New(Config{SubstackBase: func(host string) string {
		if host != "www.astralcodexten.com" {
			t.Errorf("host = %q", host)
		}
		return srv.URL
	}})
	c, err := s.Get(context.Background(), Target{Kind: "substack", URL: "https://www.astralcodexten.com/p/your-book-review"})
	if err != nil {
		t.Fatal(err)
	}
	if c.Counts != (Counts{Likes: 83, Reposts: 3, Replies: 61}) {
		t.Fatalf("counts = %+v", c.Counts)
	}
	if len(c.Replies) != 2 || c.Replies[0].Author != "SMK" || c.Replies[1].Replies != 1 {
		t.Fatalf("replies = %+v", c.Replies)
	}
	if c.Replies[0].URL != "https://www.astralcodexten.com/p/your-book-review/comment/3" {
		t.Fatalf("comment url = %q", c.Replies[0].URL)
	}
	if c.URL != "https://www.astralcodexten.com/p/your-book-review/comments" {
		t.Fatalf("url = %q", c.URL)
	}
}

func TestYouTube(t *testing.T) {
	tests := []struct {
		name       string
		threads    func(w http.ResponseWriter)
		wantErr    bool
		wantCount  int
		wantFirst  string
		wantCounts Counts
	}{
		{
			name: "comments",
			threads: func(w http.ResponseWriter) {
				_, _ = w.Write([]byte(`{"items":[
				 {"snippet":{"totalReplyCount":3,"topLevelComment":{"id":"c1","snippet":{"authorDisplayName":"@low","textDisplay":"ok","likeCount":5,"publishedAt":"2026-11-01T00:00:00Z"}}}},
				 {"snippet":{"totalReplyCount":0,"topLevelComment":{"id":"c2","snippet":{"authorDisplayName":"@high","textDisplay":"great","likeCount":90,"publishedAt":"2026-11-01T00:00:00Z"}}}}]}`))
			},
			wantCount: 2, wantFirst: "high",
			wantCounts: Counts{Likes: 1000, Replies: 42, Views: 123456},
		},
		{
			name: "comments disabled",
			threads: func(w http.ResponseWriter) {
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":{"errors":[{"reason":"commentsDisabled"}]}}`))
			},
			wantCount:  0,
			wantCounts: Counts{Likes: 1000, Replies: 42, Views: 123456},
		},
		{
			name: "quota exceeded",
			threads: func(w http.ResponseWriter) {
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":{"errors":[{"reason":"quotaExceeded"}]}}`))
			},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("key") != "k" {
					t.Errorf("missing key")
				}
				switch r.URL.Path {
				case "/videos":
					_, _ = w.Write([]byte(`{"items":[{"statistics":{"viewCount":"123456","likeCount":"1000","commentCount":"42"}}]}`))
				case "/commentThreads":
					if r.URL.Query().Get("videoId") != "dQw4w9WgXcQ" {
						t.Errorf("videoId = %q", r.URL.Query().Get("videoId"))
					}
					tt.threads(w)
				}
			}))
			defer srv.Close()
			c, err := New(Config{YouTubeKey: "k", YouTubeBase: srv.URL}).Get(context.Background(),
				Target{Kind: "youtube", URL: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
			if tt.wantErr {
				if err == nil {
					t.Fatal("want error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(c.Replies) != tt.wantCount || c.Counts != tt.wantCounts {
				t.Fatalf("replies=%d counts=%+v", len(c.Replies), c.Counts)
			}
			if tt.wantFirst != "" && c.Replies[0].Author != tt.wantFirst {
				t.Fatalf("first = %q", c.Replies[0].Author)
			}
			if tt.wantCount > 0 && !strings.HasSuffix(c.Replies[0].URL, "&lc=c2") {
				t.Fatalf("comment url = %q", c.Replies[0].URL)
			}
		})
	}
}

func TestUnsupported(t *testing.T) {
	s := New(Config{}) // no YouTube key
	tests := []Target{
		{Kind: "youtube", URL: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
		{Kind: "rss", URL: "https://example.com/a"},
	}
	for _, target := range tests {
		t.Run(target.URL, func(t *testing.T) {
			if s.Supported(target) {
				t.Fatal("supported")
			}
			if _, err := s.Get(context.Background(), target); !errors.Is(err, ErrUnsupported) {
				t.Fatalf("err = %v", err)
			}
		})
	}
}
