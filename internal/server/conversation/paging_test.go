package conversation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

const rootURI = "at://did:plc:a/app.bsky.feed.post/3root"

// bskyNode builds a threadViewPost JSON node with n children of its own.
func bskyNode(name string, likes, replyCount int, children []string) string {
	kids := ""
	if children != nil {
		kids = `,"replies":[` + strings.Join(children, ",") + `]`
	}
	return fmt.Sprintf(`{"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":"at://did:plc:x/app.bsky.feed.post/%s","author":{"handle":"%s.test"},
		"record":{"text":"%s","createdAt":"2026-11-02T10:00:00Z"},"likeCount":%d,"replyCount":%d}%s}`, name, name, name, likes, replyCount, kids)
}

// pagingServer is a fake AppView: a root post with `top` top-level replies (the
// first has 8 children, the second is cut off at the depth limit), quotes in
// pages of QuotesPage, and reposts in pages of RepostsPage.
func pagingServer(t *testing.T, top, quotes, reposts int, hits *atomic.Int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		q := r.URL.Query()
		switch r.URL.Path {
		case "/app.bsky.feed.getPostThread":
			if q.Get("uri") == "at://did:plc:x/app.bsky.feed.post/r1" {
				// A subtree: the cut-off reply's own replies.
				kids := []string{bskyNode("s1", 1, 0, nil), bskyNode("s2", 5, 0, nil)}
				fmt.Fprintf(w, `{"thread":%s}`, bskyNode("r1", 0, 2, kids))
				return
			}
			var replies []string
			for i := 0; i < top; i++ {
				switch i {
				case 0:
					var kids []string
					for k := 0; k < 8; k++ {
						kids = append(kids, bskyNode("c"+strconv.Itoa(k), k, 0, []string{}))
					}
					replies = append(replies, bskyNode("r0", 1000, 8, kids))
				case 1:
					replies = append(replies, bskyNode("r1", 999, 2, nil)) // depth limit: no replies key
				default:
					replies = append(replies, bskyNode("r"+strconv.Itoa(i), top-i, 0, []string{}))
				}
			}
			fmt.Fprintf(w, `{"thread":{"$type":"app.bsky.feed.defs#threadViewPost","post":{"uri":%q,"author":{"handle":"a.test"},
				"record":{"text":"root"},"likeCount":5,"repostCount":%d,"replyCount":%d,"quoteCount":%d},"replies":[%s]}}`,
				rootURI, reposts, top, quotes, strings.Join(replies, ","))
		case "/app.bsky.feed.getQuotes":
			off, _ := strconv.Atoi(q.Get("cursor"))
			var posts []string
			for i := off; i < min(quotes, off+QuotesPage); i++ {
				posts = append(posts, fmt.Sprintf(`{"uri":"at://did:plc:q/app.bsky.feed.post/q%d","author":{"handle":"q%d.test"},"record":{"text":"q"},"likeCount":0}`, i, i))
			}
			fmt.Fprintf(w, `{"posts":[%s],"cursor":"%d"}`, strings.Join(posts, ","), off+QuotesPage)
		case "/app.bsky.feed.getRepostedBy":
			off, _ := strconv.Atoi(q.Get("cursor"))
			var people []string
			for i := off; i < min(reposts, off+RepostsPage); i++ {
				people = append(people, fmt.Sprintf(`{"did":"did:plc:p%d","handle":"p%d.test","displayName":"P %d"}`, i, i, i))
			}
			fmt.Fprintf(w, `{"repostedBy":[%s],"cursor":"%d"}`, strings.Join(people, ","), off+RepostsPage)
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestBlueskyPaging(t *testing.T) {
	var hits atomic.Int32
	srv := pagingServer(t, 45, 30, 60, &hits)
	defer srv.Close()
	s := New(Config{BskyBase: srv.URL})
	target := Target{Kind: "bluesky", ExternalID: rootURI}
	ctx := context.Background()

	first, err := s.Get(ctx, target)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Replies) != RepliesPage || first.Cursors[KindReplies] != "20" {
		t.Fatalf("first page: %d replies, cursors %v", len(first.Replies), first.Cursors)
	}
	if len(first.Quotes) != QuotesPage || first.Cursors[KindQuotes] != "25" {
		t.Fatalf("first quotes: %d, cursors %v", len(first.Quotes), first.Cursors)
	}
	if c, ok := first.Cursors[KindReposts]; ok {
		t.Fatalf("reposts cursor offered: %q", c)
	}
	// A reply with more children than a page shows, and one cut off at depth.
	r0, r1 := first.Replies[0], first.Replies[1]
	if len(r0.Children) != ChildrenShown || r0.MoreReplies != 2 || r0.Children[0].Text != "c7" {
		t.Fatalf("r0: %d children, more %d, first %q", len(r0.Children), r0.MoreReplies, r0.Children[0].Text)
	}
	if len(r1.Children) != 0 || r1.MoreReplies != 2 || r1.ID != "at://did:plc:x/app.bsky.feed.post/r1" {
		t.Fatalf("r1 = %+v", r1)
	}

	tests := []struct {
		name, kind, cursor, id string
		wantItems, wantPeople  int
		wantCursor             string
		wantFirst              string
	}{
		{"replies page 2", KindReplies, "20", "", 20, 0, "40", "r20"},
		{"replies page 3, the end", KindReplies, "40", "", 5, 0, "", "r40"},
		{"replies past the end", KindReplies, "400", "", 0, 0, "", ""},
		{"quotes page 2, the end", KindQuotes, "25", "", 5, 0, "", "q"},
		{"reposts page 1", KindReposts, "", "", 0, RepostsPage, "50", ""},
		{"reposts page 2, the end", KindReposts, "50", "", 0, 10, "", ""},
		{"a cut-off reply's thread", KindThread, "", "at://did:plc:x/app.bsky.feed.post/r1", 2, 0, "", "s2"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, err := s.More(ctx, target, tt.kind, tt.cursor, tt.id)
			if err != nil {
				t.Fatal(err)
			}
			if len(p.Items) != tt.wantItems || len(p.People) != tt.wantPeople || p.Cursor != tt.wantCursor {
				t.Fatalf("items %d people %d cursor %q", len(p.Items), len(p.People), p.Cursor)
			}
			if tt.wantFirst != "" && p.Items[0].Text != tt.wantFirst {
				t.Fatalf("first = %q", p.Items[0].Text)
			}
		})
	}

	// Pages are cached: asking again costs nothing.
	before := hits.Load()
	for _, k := range []string{KindQuotes, KindReposts} {
		if _, err := s.More(ctx, target, k, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.More(ctx, target, KindReplies, "20", ""); err != nil {
		t.Fatal(err)
	}
	// The two first-time pages above were quotes "" and nothing else.
	if got := hits.Load() - before; got != 1 {
		t.Fatalf("cached pages hit the network %d times", got)
	}
}

func TestMoreBadPages(t *testing.T) {
	var hits atomic.Int32
	srv := pagingServer(t, 3, 0, 0, &hits)
	defer srv.Close()
	s := New(Config{BskyBase: srv.URL, SubstackBase: func(string) string { return srv.URL }})
	bsky := Target{Kind: "bluesky", ExternalID: rootURI}
	tests := []struct {
		name   string
		target Target
		kind   string
		cursor string
		id     string
		want   error
	}{
		{"unknown kind", bsky, "likes", "", "", ErrBadPage},
		{"bad offset", bsky, KindReplies, "x", "", ErrBadPage},
		{"negative offset", bsky, KindReplies, "-1", "", ErrBadPage},
		{"thread without an at uri", bsky, KindThread, "", "https://evil.test", ErrBadPage},
		{"substack has no quotes", Target{Kind: "substack", URL: "https://x.substack.com/p/a"}, KindQuotes, "", "", ErrBadPage},
		{"unsupported item", Target{Kind: "rss", URL: "https://example.com/a"}, KindReplies, "0", "", ErrUnsupported},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := s.More(context.Background(), tt.target, tt.kind, tt.cursor, tt.id); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestSubstackPaging(t *testing.T) {
	// 27 top-level comments; the most-liked has 9 replies, one of which has its own.
	type sc map[string]any
	var comments []sc
	for i := 0; i < 27; i++ {
		c := sc{"id": i + 1, "name": "n" + strconv.Itoa(i), "body": "b" + strconv.Itoa(i), "reaction_count": 100 - i, "date": "2026-11-01T00:00:00Z"}
		if i == 0 {
			var kids []sc
			for k := 0; k < 9; k++ {
				kid := sc{"id": 100 + k, "name": "k", "body": "k" + strconv.Itoa(k), "reaction_count": k}
				if k == 8 {
					kid["children"] = []sc{{"id": 200, "name": "g", "body": "grandchild", "reaction_count": 0}}
				}
				kids = append(kids, kid)
			}
			c["children"] = kids
			c["children_count"] = 9
		}
		comments = append(comments, c)
	}
	// A deleted comment whose reply still stands.
	comments = append(comments, sc{"id": 999, "deleted": true, "body": nil, "reaction_count": 0,
		"children": []sc{{"id": 1000, "name": "orphan", "body": "still here", "reaction_count": 0}}})
	body, _ := json.Marshal(map[string]any{"comments": comments})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/posts/a":
			_, _ = w.Write([]byte(`{"id":7,"reaction_count":1,"comment_count":38,"restacks":0}`))
		case "/api/v1/post/7/comments":
			_, _ = w.Write(body)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	s := New(Config{SubstackBase: func(string) string { return srv.URL }})
	target := Target{Kind: "substack", URL: "https://x.substack.com/p/a"}
	ctx := context.Background()

	first, err := s.Get(ctx, target)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Replies) != RepliesPage || first.Cursors[KindReplies] != "20" || len(first.Cursors) != 1 {
		t.Fatalf("first: %d replies, cursors %v", len(first.Replies), first.Cursors)
	}
	top := first.Replies[0]
	if top.ID != "1" || len(top.Children) != ChildrenShown || top.MoreReplies != 3 || top.Children[0].Text != "k8" || len(top.Children[0].Children) != 1 {
		t.Fatalf("top = %+v", top)
	}
	next, err := s.More(ctx, target, KindReplies, "20", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(next.Items) != 8 || next.Cursor != "" || next.Items[7].Text != "still here" {
		t.Fatalf("page 2: %d items, cursor %q, last %+v", len(next.Items), next.Cursor, next.Items[len(next.Items)-1])
	}
	thread, err := s.More(ctx, target, KindThread, "", "1")
	if err != nil {
		t.Fatal(err)
	}
	if len(thread.Items) != 9 || thread.Items[8].Text != "k0" {
		t.Fatalf("thread: %d items", len(thread.Items))
	}
	if _, err := s.More(ctx, target, KindThread, "", "nope"); !errors.Is(err, ErrBadPage) {
		t.Fatalf("unknown comment: err = %v", err)
	}
}
