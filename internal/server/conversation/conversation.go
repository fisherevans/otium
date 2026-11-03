// Package conversation fetches the public conversation around an item (#200):
// a Bluesky post's replies, quotes and the post it quotes; a Substack post's
// comments; a YouTube video's top comments. Everything is plain text, read-only
// and unauthenticated except YouTube, which needs the Data API key
// (commentThreads.list and videos.list cost one quota unit each).
//
// A Service is fetched on demand, one item at a time, and caches each result in
// memory for TTL (counts change, so it is short). Failures are cached for a
// shorter time so a dead endpoint is not hit on every card. It is safe for
// concurrent use; there is nothing to close.
//
//	svc := conversation.New(conversation.Config{YouTubeKey: key})
//	conv, err := svc.Get(ctx, conversation.Target{Kind: "bluesky", ExternalID: uri})
package conversation

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fisherevans/otium/internal/server/richtext"
)

// Platforms. Empty means the item has no conversation otium can fetch.
const (
	Bluesky  = "bluesky"
	Substack = "substack"
	YouTube  = "youtube"
)

// Counts are the post's numbers on its own platform. Views is YouTube only.
type Counts struct {
	Likes   int   `json:"likes"`
	Reposts int   `json:"reposts"`
	Replies int   `json:"replies"`
	Quotes  int   `json:"quotes"`
	Views   int64 `json:"views,omitempty"`
}

// Comment is one reply, quote or comment. Text is plain text, never HTML.
type Comment struct {
	// ID names the comment for More(kind "thread"): a Bluesky at:// URI, a
	// Substack comment id. Empty for YouTube.
	ID        string `json:"id,omitempty"`
	Author    string `json:"author"`
	Handle    string `json:"handle,omitempty"`
	AvatarURL string `json:"avatar_url,omitempty"`
	Text      string `json:"text"`
	// Segments is Text with its links (#207), when it has any: concatenated, the
	// segments' text is Text. Bluesky only.
	Segments []richtext.Segment `json:"segments,omitempty"`
	URL      string             `json:"url,omitempty"`
	Likes    int                `json:"likes"`
	Replies  int                `json:"replies"`
	Media    string             `json:"media,omitempty"` // image | video | link: something the text does not show
	// What a Bluesky reply or quote carries (#210), drawn small under its text:
	// its pictures, link card, video poster and the post it quotes.
	Images      []richtext.Image `json:"images,omitempty"`
	Link        *richtext.Link   `json:"link,omitempty"`
	Video       *richtext.Video  `json:"video,omitempty"`
	Quote       *richtext.Quote  `json:"quote,omitempty"`
	PublishedAt time.Time        `json:"published_at"`
	// Children are the replies to this reply (#207), most-liked first, as deep as
	// the platform gave them. Bluesky only.
	Children []Comment `json:"children,omitempty"`
	// MoreReplies counts replies to this one that are not in Children (#209):
	// beyond the fetched depth, or past the few shown per level. More(kind
	// "thread", ID) loads them.
	MoreReplies int `json:"more_replies,omitempty"`
}

// Conversation is what GET /items/{id}/conversation returns.
type Conversation struct {
	Platform string    `json:"platform"`
	URL      string    `json:"url,omitempty"` // the item on its platform ("Open on Bluesky")
	Counts   Counts    `json:"counts"`
	Replies  []Comment `json:"replies"` // most-liked first
	Quotes   []Comment `json:"quotes"`  // most-liked first
	// Quoted is the post this item itself quotes (Bluesky), shown as an inset.
	Quoted    *Comment  `json:"quoted,omitempty"`
	FetchedAt time.Time `json:"fetched_at"`
	// Cursors says what more there is to load (#209): a key is present when that
	// kind has another page, and its value is the cursor to pass to More - which
	// may be "" for "from the start" (reposts, which the first answer never
	// carries). Kinds: replies, quotes, reposts.
	Cursors map[string]string `json:"cursors,omitempty"`

	quotesCursor string // Bluesky's cursor after the first page of quotes
}

// Target identifies an item and the source it came from.
type Target struct {
	Kind       string // the source's kind: rss | youtube | bluesky | substack | medium | podcast
	FeedURL    string
	URL        string
	ExternalID string
}

// PlatformOf decides which platform's conversation an item has, or "".
func PlatformOf(t Target) string {
	switch {
	case t.Kind == Bluesky && strings.HasPrefix(t.ExternalID, "at://"):
		return Bluesky
	case t.Kind == Substack, strings.HasSuffix(hostOf(t.FeedURL), ".substack.com"):
		if substackSlug(t.URL) != "" {
			return Substack
		}
	case YouTubeVideoID(t.URL) != "":
		return YouTube
	}
	return ""
}

// Config points the Service at its upstreams. Zero values are production.
type Config struct {
	YouTubeKey string // empty disables YouTube comments
	TTL        time.Duration
	// Test overrides.
	BskyBase     string
	YouTubeBase  string
	SubstackBase func(host string) string
	HTTP         *http.Client
}

type Service struct {
	cfg   Config
	http  *http.Client
	mu    sync.Mutex
	cache map[string]entry
	pages map[string]pageEntry
	now   func() time.Time
}

type entry struct {
	conv    *Conversation
	err     error
	expires time.Time
}

// ErrUnsupported means the item has no conversation to fetch.
var ErrUnsupported = fmt.Errorf("no conversation for this item")

func New(cfg Config) *Service {
	if cfg.TTL <= 0 {
		cfg.TTL = 10 * time.Minute
	}
	if cfg.BskyBase == "" {
		cfg.BskyBase = "https://public.api.bsky.app/xrpc"
	}
	if cfg.YouTubeBase == "" {
		cfg.YouTubeBase = "https://www.googleapis.com/youtube/v3"
	}
	if cfg.SubstackBase == nil {
		cfg.SubstackBase = func(host string) string { return "https://" + host }
	}
	hc := cfg.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 15 * time.Second}
	}
	return &Service{cfg: cfg, http: hc, cache: map[string]entry{}, pages: map[string]pageEntry{}, now: time.Now}
}

// Supported reports whether Get can answer for this item at all (YouTube needs
// a key).
func (s *Service) Supported(t Target) bool {
	p := PlatformOf(t)
	return p != "" && (p != YouTube || s.cfg.YouTubeKey != "")
}

// Get returns the first page of the item's conversation (#209): the first
// RepliesPage top-level replies with a few replies under each, the first page of
// quotes, and Cursors for the rest. From cache when fresh.
func (s *Service) Get(ctx context.Context, t Target) (*Conversation, error) {
	conv, err := s.full(ctx, t)
	if err != nil {
		return nil, err
	}
	return firstPage(conv), nil
}

// full returns the whole conversation as fetched, from cache when fresh.
func (s *Service) full(ctx context.Context, t Target) (*Conversation, error) {
	if !s.Supported(t) {
		return nil, ErrUnsupported
	}
	p := PlatformOf(t)
	key := p + "|" + t.ExternalID + "|" + t.URL
	now := s.now()
	s.mu.Lock()
	if e, ok := s.cache[key]; ok && now.Before(e.expires) {
		s.mu.Unlock()
		return e.conv, e.err
	}
	s.mu.Unlock()

	var conv *Conversation
	var err error
	switch p {
	case Bluesky:
		conv, err = s.bluesky(ctx, t.ExternalID)
	case Substack:
		conv, err = s.substack(ctx, t.URL)
	case YouTube:
		conv, err = s.youtube(ctx, YouTubeVideoID(t.URL))
	}
	if ctx.Err() != nil {
		return nil, ctx.Err() // the caller went away; don't cache that
	}
	ttl := s.cfg.TTL
	if err != nil {
		ttl = time.Minute
	} else {
		conv.Platform = p
		conv.FetchedAt = now.UTC()
		if conv.Replies == nil {
			conv.Replies = []Comment{}
		}
		if conv.Quotes == nil {
			conv.Quotes = []Comment{}
		}
	}
	s.mu.Lock()
	if len(s.cache) > 1000 {
		for k, e := range s.cache {
			if !now.Before(e.expires) {
				delete(s.cache, k)
			}
		}
	}
	s.cache[key] = entry{conv: conv, err: err, expires: now.Add(ttl)}
	s.mu.Unlock()
	return conv, err
}

// mostLiked orders comments by likes, then by replies, keeping the platform's
// own order among ties.
func mostLiked(cs []Comment) {
	sort.SliceStable(cs, func(i, j int) bool {
		if cs[i].Likes != cs[j].Likes {
			return cs[i].Likes > cs[j].Likes
		}
		return cs[i].Replies > cs[j].Replies
	})
}

func (s *Service) getJSON(ctx context.Context, u string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "otium/1 (+https://github.com/fisherevans/otium)")
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != http.StatusOK {
		return &HTTPError{Status: resp.StatusCode, Body: string(raw[:min(len(raw), 300)])}
	}
	return json.Unmarshal(raw, out)
}

// HTTPError is a non-200 upstream answer.
type HTTPError struct {
	Status int
	Body   string
}

func (e *HTTPError) Error() string { return fmt.Sprintf("http %d: %s", e.Status, e.Body) }

func hostOf(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Host)
}

func clipText(s string, n int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	cut := string(r[:n])
	if i := strings.LastIndexAny(cut, " \n\t"); i > n/2 {
		cut = cut[:i]
	}
	return strings.TrimSpace(cut) + "…"
}

func parseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t.UTC()
}
