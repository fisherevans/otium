// Package social resolves and fetches the "social" source kinds (#197): Bluesky
// (native, through the public AppView API), Substack and Medium (RSS for content,
// plus Substack's public post API for engagement counts).
//
// Everything here is unauthenticated and read-only. A Client is safe for
// concurrent use.
package social

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const bskyBase = "https://public.api.bsky.app/xrpc"

type Client struct {
	http *http.Client
	// BskyBase overrides the AppView root (tests).
	BskyBase string
}

func New() *Client {
	return &Client{http: &http.Client{Timeout: 20 * time.Second}, BskyBase: bskyBase}
}

// Resolved is what the add-source flow needs to create a source.
type Resolved struct {
	Kind    string `json:"kind"`
	FeedURL string `json:"feed_url"`
	Title   string `json:"title"`
	IconURL string `json:"icon_url"`
	// HomeURL is where "Open" in the wizard goes, to check it's the right one.
	HomeURL string `json:"home_url"`
}

// Engagement is a post's counts on its own platform.
type Engagement struct {
	Likes   int
	Reposts int
	Replies int
}

// Post is one fetched post, already shaped for an otium item.
type Post struct {
	ExternalID   string
	URL          string
	Title        string
	Summary      string
	ContentHTML  string
	Author       string
	ThumbnailURL string
	MediaType    string
	PublishedAt  time.Time
	Engagement   Engagement
}

// ---- Bluesky ----------------------------------------------------------------

// BskyFeedURL is the canonical feed_url stored for a Bluesky source. It is a
// marker the ingester recognises, not something fetched as RSS.
func BskyFeedURL(did string) string { return "bsky:" + did }

// BskyActor extracts the DID from a stored Bluesky feed_url ("bsky:<did>"), or ""
// when the URL is not one.
func BskyActor(feedURL string) string {
	if strings.HasPrefix(feedURL, "bsky:") {
		return strings.TrimPrefix(feedURL, "bsky:")
	}
	return ""
}

// ParseBskyInput turns what a person pastes into an actor identifier: a handle
// ("@name.bsky.social", "name.bsky.social"), a profile or post URL, or a DID.
func ParseBskyInput(in string) string {
	s := strings.TrimSpace(in)
	if u, err := url.Parse(s); err == nil && u.Host != "" {
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(parts) >= 2 && parts[0] == "profile" {
			return parts[1]
		}
		return ""
	}
	s = strings.TrimPrefix(s, "@")
	if !strings.Contains(s, ".") && !strings.HasPrefix(s, "did:") {
		s += ".bsky.social" // a bare name almost always means the default host
	}
	return s
}

type bskyProfile struct {
	DID         string `json:"did"`
	Handle      string `json:"handle"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

func (c *Client) ResolveBluesky(ctx context.Context, input string) (*Resolved, error) {
	actor := ParseBskyInput(input)
	if actor == "" {
		return nil, fmt.Errorf("that doesn't look like a Bluesky handle or profile link")
	}
	var p bskyProfile
	if err := c.getJSON(ctx, c.BskyBase+"/app.bsky.actor.getProfile?actor="+url.QueryEscape(actor), &p); err != nil {
		return nil, fmt.Errorf("couldn't find %s on Bluesky: %w", actor, err)
	}
	title := p.DisplayName
	if title == "" {
		title = p.Handle
	}
	return &Resolved{
		Kind: "bluesky", FeedURL: BskyFeedURL(p.DID), Title: title, IconURL: p.Avatar,
		HomeURL: "https://bsky.app/profile/" + p.Handle,
	}, nil
}

type bskyFeed struct {
	Feed []struct {
		Post   bskyPost        `json:"post"`
		Reason json.RawMessage `json:"reason"`
	} `json:"feed"`
}

type bskyPost struct {
	URI    string `json:"uri"`
	Author struct {
		Handle      string `json:"handle"`
		DisplayName string `json:"displayName"`
	} `json:"author"`
	Record struct {
		Text      string `json:"text"`
		CreatedAt string `json:"createdAt"`
	} `json:"record"`
	Embed       *bskyEmbed `json:"embed"`
	LikeCount   int        `json:"likeCount"`
	RepostCount int        `json:"repostCount"`
	ReplyCount  int        `json:"replyCount"`
	QuoteCount  int        `json:"quoteCount"`
}

type bskyEmbed struct {
	Type   string `json:"$type"`
	Images []struct {
		Thumb    string `json:"thumb"`
		Fullsize string `json:"fullsize"`
		Alt      string `json:"alt"`
	} `json:"images"`
	External *struct {
		URI         string `json:"uri"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Thumb       string `json:"thumb"`
	} `json:"external"`
	Thumbnail string `json:"thumbnail"` // video
	// recordWithMedia nests the media part.
	Media *bskyEmbed `json:"media"`
}

// FetchBluesky returns the actor's own recent posts (no reposts, no replies).
func (c *Client) FetchBluesky(ctx context.Context, did string, limit int) ([]Post, error) {
	q := url.Values{"actor": {did}, "filter": {"posts_no_replies"}, "limit": {fmt.Sprint(limit)}}
	var f bskyFeed
	if err := c.getJSON(ctx, c.BskyBase+"/app.bsky.feed.getAuthorFeed?"+q.Encode(), &f); err != nil {
		return nil, err
	}
	var out []Post
	for _, e := range f.Feed {
		if len(e.Reason) > 0 && string(e.Reason) != "null" {
			continue // a repost of someone else
		}
		if p, ok := bskyToPost(e.Post); ok {
			out = append(out, p)
		}
	}
	return out, nil
}

func bskyToPost(p bskyPost) (Post, bool) {
	rkey := p.URI[strings.LastIndex(p.URI, "/")+1:]
	if rkey == "" {
		return Post{}, false
	}
	created, err := time.Parse(time.RFC3339, p.Record.CreatedAt)
	if err != nil {
		created = time.Now().UTC()
	}
	text := strings.TrimSpace(p.Record.Text)
	post := Post{
		ExternalID:  p.URI,
		URL:         "https://bsky.app/profile/" + p.Author.Handle + "/post/" + rkey,
		Author:      firstNonEmpty(p.Author.DisplayName, p.Author.Handle),
		PublishedAt: created.UTC(),
		MediaType:   "article",
		Engagement:  Engagement{Likes: p.LikeCount, Reposts: p.RepostCount + p.QuoteCount, Replies: p.ReplyCount},
	}

	var body strings.Builder
	if text != "" {
		body.WriteString("<p>" + strings.ReplaceAll(html.EscapeString(text), "\n", "<br>") + "</p>")
	}
	e := p.Embed
	if e != nil && e.Media != nil {
		e = e.Media
	}
	linkTitle := ""
	if e != nil {
		for _, im := range e.Images {
			if post.ThumbnailURL == "" {
				post.ThumbnailURL = im.Thumb
			}
			body.WriteString(`<p><img src="` + html.EscapeString(firstNonEmpty(im.Fullsize, im.Thumb)) + `" alt="` + html.EscapeString(im.Alt) + `"></p>`)
		}
		if x := e.External; x != nil {
			linkTitle = x.Title
			if post.ThumbnailURL == "" {
				post.ThumbnailURL = x.Thumb
			}
			body.WriteString(`<p><a href="` + html.EscapeString(x.URI) + `">` + html.EscapeString(firstNonEmpty(x.Title, x.URI)) + `</a>`)
			if x.Description != "" {
				body.WriteString("<br>" + html.EscapeString(x.Description))
			}
			body.WriteString("</p>")
		}
		if e.Thumbnail != "" && post.ThumbnailURL == "" {
			post.ThumbnailURL = e.Thumbnail
			body.WriteString(`<p><img src="` + html.EscapeString(e.Thumbnail) + `" alt="Video"></p><p><a href="` + post.URL + `">Watch on Bluesky</a></p>`)
		}
	}
	// A post has no headline. The text is the headline; a link-only post borrows the
	// link's title so the card is never blank.
	post.Title = PostTitle(firstNonEmpty(text, linkTitle, "Post by "+post.Author))
	post.Summary = postRemainder(text, post.Title)
	post.ContentHTML = body.String()
	return post, true
}

// postRemainder is the summary under a post's headline: whatever of the text
// the headline did not already show, so a one-line post isn't printed twice.
func postRemainder(text, title string) string {
	t := strings.TrimSpace(text)
	if strings.HasSuffix(title, "…") {
		return clip(t, 500) // the headline was clipped; the card shows the start again in full
	}
	rest := strings.TrimSpace(strings.TrimPrefix(t, strings.TrimSpace(title)))
	return clip(rest, 500)
}

// PostTitle turns post text into a card headline: the first line, clipped at a
// word boundary.
func PostTitle(text string) string {
	line := strings.TrimSpace(strings.SplitN(strings.TrimSpace(text), "\n", 2)[0])
	return clip(line, 200)
}

// ---- Substack ---------------------------------------------------------------

// SubstackHost turns a publication name, URL or post URL into its host:
// "astralcodexten" -> "astralcodexten.substack.com".
func SubstackHost(in string) string {
	s := strings.TrimSpace(in)
	if !strings.Contains(s, "://") {
		if !strings.Contains(s, ".") {
			return strings.TrimPrefix(s, "@") + ".substack.com"
		}
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return ""
	}
	// substack.com/@name profiles map to name.substack.com.
	if strings.TrimPrefix(u.Host, "www.") == "substack.com" && strings.HasPrefix(u.Path, "/@") {
		return strings.TrimPrefix(strings.Split(u.Path, "/")[1], "@") + ".substack.com"
	}
	return u.Host
}

type substackPost struct {
	CanonicalURL  string `json:"canonical_url"`
	ReactionCount int    `json:"reaction_count"`
	CommentCount  int    `json:"comment_count"`
	Restacks      int    `json:"restacks"`
}

// SubstackEngagement returns the counts for a publication's recent posts, keyed
// by canonical URL (which is what its RSS links to).
func (c *Client) SubstackEngagement(ctx context.Context, feedURL string) (map[string]Engagement, error) {
	u, err := url.Parse(feedURL)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("bad substack feed url")
	}
	var posts []substackPost
	if err := c.getJSON(ctx, "https://"+u.Host+"/api/v1/archive?sort=new&limit=50", &posts); err != nil {
		return nil, err
	}
	out := make(map[string]Engagement, len(posts))
	for _, p := range posts {
		out[NormalizeURL(p.CanonicalURL)] = Engagement{Likes: p.ReactionCount, Reposts: p.Restacks, Replies: p.CommentCount}
	}
	return out, nil
}

// ---- Medium -----------------------------------------------------------------

// MediumFeedURL maps a Medium profile, publication or custom-domain URL to its
// RSS feed.
func MediumFeedURL(in string) string {
	s := strings.TrimSpace(in)
	if strings.HasPrefix(s, "@") {
		return "https://medium.com/feed/" + s
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return ""
	}
	host := strings.TrimPrefix(u.Host, "www.")
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if host == "medium.com" {
		if len(parts) > 0 && parts[0] == "feed" {
			return "https://medium.com/" + strings.Join(parts, "/")
		}
		if len(parts) > 0 && parts[0] != "" {
			return "https://medium.com/feed/" + parts[0]
		}
		return ""
	}
	if strings.HasSuffix(host, ".medium.com") { // name.medium.com
		return "https://" + host + "/feed"
	}
	return "https://" + host + "/feed" // a custom-domain publication
}

// ---- helpers ----------------------------------------------------------------

// NormalizeURL makes URLs comparable across RSS and API: no query, fragment or
// trailing slash, lower-case host.
func NormalizeURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return raw
	}
	u.RawQuery, u.Fragment = "", ""
	u.Host = strings.ToLower(strings.TrimPrefix(u.Host, "www."))
	u.Scheme = "https"
	return strings.TrimRight(u.String(), "/")
}

func (c *Client) getJSON(ctx context.Context, u string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "otium/1 (+https://github.com/fisherevans/otium)")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &e)
		if e.Message != "" {
			return fmt.Errorf("%s (http %d)", e.Message, resp.StatusCode)
		}
		return fmt.Errorf("http %d", resp.StatusCode)
	}
	return json.Unmarshal(raw, out)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func clip(s string, n int) string {
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
