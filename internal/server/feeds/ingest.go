// Package feeds fetches a source's RSS/Atom feed and normalizes each entry into
// a store.Item. It handles plain RSS, YouTube channel feeds (Atom + media
// namespace), and podcasts (itunes:duration), collapsing them into one shape so
// the rest of otium never cares where an item came from.
package feeds

import (
	"context"
	"errors"
	"github.com/fisherevans/otium/internal/server/shortform"
	"html"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/mmcdole/gofeed"

	"github.com/fisherevans/otium/internal/server/media"
	"github.com/fisherevans/otium/internal/server/richtext"
	"github.com/fisherevans/otium/internal/server/social"
	"github.com/fisherevans/otium/internal/server/store"
	"github.com/fisherevans/otium/internal/server/youtube"
)

var errBadBlueskySource = errors.New("not a Bluesky source: feed_url should be bsky:<did>")

type Ingester struct {
	db     *store.DB
	parser *gofeed.Parser
	log    *slog.Logger
	yt     *youtube.Client // nil unless a Data API key is configured
	soc    *social.Client  // Bluesky posts and Substack engagement (#197); keyless
}

func NewIngester(db *store.DB, log *slog.Logger) *Ingester {
	p := gofeed.NewParser()
	p.UserAgent = "otium/0.1 (+https://otium.fisher.sh)"
	return &Ingester{db: db, parser: p, log: log, soc: social.New()}
}

// SetYouTube enables the API-native ongoing fetch for youtube sources. When set,
// FetchSource pulls a youtube channel's latest uploads (with duration + stats) via
// the Data API instead of parsing its RSS feed. Called once at startup when a key
// is present.
func (ing *Ingester) SetYouTube(c *youtube.Client) { ing.yt = c }

// FetchSource pulls one source's feed and upserts its items. Returns the count
// of newly inserted items. A fetch/parse error is recorded on the source and
// returned, but is not fatal to a batch run.
func (ing *Ingester) FetchSource(ctx context.Context, s store.Source) (int, error) {
	if s.Kind == "youtube" && ing.yt != nil {
		if n, err, ok := ing.fetchYouTube(ctx, s); ok {
			return n, err
		}
		// Not a resolvable channel feed - fall through to RSS parsing.
	}
	if s.Kind == "bluesky" {
		return ing.fetchBluesky(ctx, s)
	}

	fctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	feed, err := ing.parser.ParseURLWithContext(s.FeedURL, fctx)
	if err != nil {
		_ = ing.db.MarkFetched(ctx, s.ID, err.Error())
		return 0, err
	}

	// Capture the feed's own channel image as the source avatar (podcast cover art,
	// RSS channel <image>) when we don't already have one. This is the creator's
	// framing - a circle to match what other feed apps show. Backfills on the next
	// fetch for sources added before this existed; only fills an empty icon so a
	// user-set or YouTube-resolved avatar is never overwritten.
	if s.IconURL == "" && feed.Image != nil && feed.Image.URL != "" {
		if err := ing.db.SetSourceIcon(ctx, s.ID, feed.Image.URL); err == nil {
			s.IconURL = feed.Image.URL
		}
	}

	// #209: Substack's archive carries each post's counts and its real length and
	// type; read it first so a short post is classified with them.
	var archive map[string]social.SubstackArchived
	if s.Kind == "substack" {
		archive = ing.substackArchive(ctx, s)
	}
	fresh := 0
	for _, e := range feed.Items {
		it := normalize(s, e)
		if it == nil {
			continue
		}
		if s.Kind == "tumblr" {
			ClassifyTumblr(it, s)
		} else if shortform.Kinds[s.Kind] {
			var known *shortform.Known
			if a, ok := archive[social.NormalizeURL(it.URL)]; ok {
				known = &shortform.Known{Words: a.Words, Type: a.Type}
			}
			ClassifyForm(it, known)
		}
		created, err := ing.db.UpsertItem(ctx, it)
		if err != nil {
			ing.log.Warn("upsert item failed", "source", s.Title, "err", err)
			continue
		}
		if created {
			fresh++
		}
	}
	if archive != nil {
		ing.storeSubstackEngagement(ctx, s, archive)
	}
	_ = ing.db.MarkFetched(ctx, s.ID, "")
	return fresh, nil
}

// fetchBluesky pulls an account's own recent posts (#197) with their like,
// repost and reply counts. Counts on posts already stored are refreshed too,
// since they keep growing after the post first arrives.
func (ing *Ingester) fetchBluesky(ctx context.Context, s store.Source) (int, error) {
	did := social.BskyActor(s.FeedURL)
	if did == "" {
		err := errBadBlueskySource
		_ = ing.db.MarkFetched(ctx, s.ID, err.Error())
		return 0, err
	}
	fctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	posts, err := ing.soc.FetchBluesky(fctx, did, 50)
	if err != nil {
		_ = ing.db.MarkFetched(ctx, s.ID, err.Error())
		return 0, err
	}
	fresh := 0
	for _, p := range posts {
		it := &store.Item{
			SourceID: s.ID, ExternalID: p.ExternalID, URL: p.URL, Title: p.Title, Summary: p.Summary,
			Content: p.ContentHTML, Author: p.Author, ThumbnailURL: p.ThumbnailURL, MediaType: p.MediaType,
			PublishedAt: p.PublishedAt, ContentSource: store.ContentSourceRSS,
			Likes: p.Engagement.Likes, Reposts: p.Engagement.Reposts, Replies: p.Engagement.Replies, HasEngagement: true,
			PostJSON: richtext.Marshal(p.Body),
		}
		created, err := ing.db.UpsertItem(ctx, it)
		if err != nil {
			ing.log.Warn("upsert bluesky post failed", "source", s.Title, "err", err)
			continue
		}
		if created {
			fresh++
		}
	}
	_ = ing.db.MarkFetched(ctx, s.ID, "")
	return fresh, nil
}

// substackArchive reads the publication's recent posts (#197, #209). Best
// effort: the RSS content is what matters, so a failure here is logged, not
// recorded as a fetch error, and nil means "unknown".
func (ing *Ingester) substackArchive(ctx context.Context, s store.Source) map[string]social.SubstackArchived {
	fctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	archive, err := ing.soc.SubstackArchive(fctx, s.FeedURL)
	if err != nil {
		ing.log.Warn("substack archive failed", "source", s.Title, "err", err)
		return nil
	}
	return archive
}

// storeSubstackEngagement layers Substack's reaction/restack/comment counts onto
// the publication's items (#197).
func (ing *Ingester) storeSubstackEngagement(ctx context.Context, s store.Source, archive map[string]social.SubstackArchived) {
	counts := make(map[string][3]int, len(archive))
	for u, e := range archive {
		counts[u] = [3]int{e.Likes, e.Reposts, e.Replies}
	}
	if _, err := ing.db.SetItemEngagementByURL(ctx, s.ID, counts, social.NormalizeURL); err != nil {
		ing.log.Warn("substack engagement store failed", "source", s.Title, "err", err)
	}
}

// ClassifyForm decides whether a Substack or Medium item is a short post or an
// article (#209) and records it on the item for UpsertItem: a post carries its
// structured body in PostJSON, so the client draws it the way it draws a Bluesky
// post.
func ClassifyForm(it *store.Item, known *shortform.Known) {
	post, _ := shortform.Classify(shortform.Input{Title: it.Title, Author: it.Author, Body: it.Content, Known: known})
	if post == nil {
		it.Form, it.PostJSON = "article", ""
		return
	}
	it.Form, it.PostJSON = "post", richtext.Marshal(post)
}

// ClassifyTumblr shapes a Tumblr entry (#216): a post when shortform.Tumblr
// says so, with the blog as its author, else an article. Either way the card's
// picture comes from the body, since Tumblr's feed names none.
func ClassifyTumblr(it *store.Item, s store.Source) {
	// Tumblr escapes its titles twice ("i&amp;rsquo;ve"); gofeed undoes one.
	it.Title = html.UnescapeString(it.Title)
	it.Summary = html.UnescapeString(it.Summary)
	author := firstNonEmpty(it.Author, s.Title)
	post, _ := shortform.Tumblr(shortform.Input{Title: it.Title, Author: author, Body: it.Content})
	if post == nil {
		it.Form, it.PostJSON = "article", ""
		if it.ThumbnailURL == "" {
			it.ThumbnailURL = firstImage(it.Content)
		}
		return
	}
	host := social.TumblrHost(s.FeedURL)
	if strings.HasSuffix(host, ".tumblr.com") {
		post.Author.Handle = strings.TrimSuffix(host, ".tumblr.com")
	}
	post.Author.Avatar = s.IconURL
	post.Author.URL = firstNonEmpty(s.HomepageURL, "https://"+host+"/")
	if q := post.Quote; q != nil && q.Author.URL != "" {
		if u, err := url.Parse(q.Author.URL); err == nil && u.Host != "" {
			q.Author.Avatar = social.TumblrAvatar(strings.TrimPrefix(u.Host, "www."))
		}
	}
	it.Author = author
	it.Form, it.PostJSON = "post", richtext.Marshal(post)
	if it.ThumbnailURL == "" {
		it.ThumbnailURL = post.Picture()
		if it.ThumbnailURL == "" && post.Quote != nil {
			if len(post.Quote.Images) > 0 {
				it.ThumbnailURL = post.Quote.Images[0].Thumb
			} else if post.Quote.Video != nil {
				it.ThumbnailURL = post.Quote.Video.Thumb
			}
		}
	}
}

// firstImage is the src of the first <img> in an HTML body, or "".
func firstImage(body string) string {
	i := strings.Index(body, "<img")
	if i < 0 {
		return ""
	}
	rest := body[i:]
	j := strings.Index(rest, `src="`)
	if j < 0 {
		return ""
	}
	rest = rest[j+5:]
	if k := strings.IndexByte(rest, '"'); k > 0 {
		return html.UnescapeString(rest[:k])
	}
	return ""
}

// BackfillForms classifies Substack and Medium items stored before #209 that no
// fetch will reach again (their feed has moved on). Without the archive's word
// count a paid post's preview reads as unknown length, so it stays an article -
// the safe side. Runs once at boot; a no-op after the first.
func (ing *Ingester) BackfillForms(ctx context.Context) (int, error) {
	n := 0
	for {
		rows, err := ing.db.UnclassifiedForms(ctx, 200)
		if err != nil || len(rows) == 0 {
			return n, err
		}
		for _, r := range rows {
			it := &store.Item{Title: r.Title, Author: r.Author, Content: r.Content}
			ClassifyForm(it, nil)
			if err := ing.db.SetItemForm(ctx, r.ID, it.Form, it.PostJSON); err != nil {
				return n, err
			}
			n++
		}
	}
}

// fetchYouTube pulls a youtube source's latest uploads via the Data API. The bool
// reports whether this path handled the source: false means the feed_url has no
// resolvable channel id and the caller should fall back to RSS.
func (ing *Ingester) fetchYouTube(ctx context.Context, s store.Source) (int, error, bool) {
	channelID := youtube.ChannelIDFromFeedURL(s.FeedURL)
	if channelID == "" {
		return 0, nil, false
	}
	fctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	vids, err := ing.yt.LatestUploads(fctx, channelID, 50)
	if err != nil {
		_ = ing.db.MarkFetched(ctx, s.ID, err.Error())
		return 0, err, true
	}
	fresh := 0
	for _, v := range vids {
		created, err := ing.db.UpsertYouTubeItem(ctx, youtube.ToItem(v, s.ID))
		if err != nil {
			ing.log.Warn("upsert youtube item failed", "source", s.Title, "err", err)
			continue
		}
		if created {
			fresh++
		}
	}
	_ = ing.db.MarkFetched(ctx, s.ID, "")
	return fresh, nil, true
}

// FetchAll fetches every non-archived source for a user, sequentially (homelab
// scale; no need to hammer). Returns total new items.
func (ing *Ingester) FetchAll(ctx context.Context, userID int64) (int, error) {
	return ing.FetchAllDue(ctx, userID, 0)
}

// FetchAllDue refreshes all non-archived sources except YouTube sources fetched
// within youtubeMinAge. New sources fetch immediately; zero forces every source.
func (ing *Ingester) FetchAllDue(ctx context.Context, userID int64, youtubeMinAge time.Duration) (int, error) {
	sources, err := ing.db.SourcesToFetch(ctx, userID)
	if err != nil {
		return 0, err
	}
	total := 0
	cutoff := time.Now().Add(-youtubeMinAge)
	for _, s := range sources {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		if youtubeMinAge > 0 && s.Kind == "youtube" && s.LastFetchAt != nil && s.LastFetchAt.After(cutoff) {
			continue
		}
		n, err := ing.FetchSource(ctx, s)
		if ctx.Err() != nil {
			return total, ctx.Err()
		}
		if err != nil {
			ing.log.Warn("fetch source failed", "source", s.Title, "url", s.FeedURL, "err", err)
			continue
		}
		total += n
	}
	return total, nil
}

func normalize(s store.Source, e *gofeed.Item) *store.Item {
	extID := e.GUID
	if extID == "" {
		extID = e.Link
	}
	if extID == "" {
		return nil
	}
	pub := time.Now().UTC()
	if e.PublishedParsed != nil {
		pub = e.PublishedParsed.UTC()
	} else if e.UpdatedParsed != nil {
		pub = e.UpdatedParsed.UTC()
	}

	dur := durationSeconds(e)
	// YouTube Atom entries carry no <content>/<summary>; the description lives in
	// media:group>media:description, which gofeed doesn't map (#120). Fall back to
	// it so video items get a body (the reader/player renders it). It's plain text,
	// so wrap to HTML preserving line breaks for the reader.
	mdesc := mediaGroupDescription(e)
	it := &store.Item{
		SourceID:   s.ID,
		ExternalID: extID,
		URL:        e.Link,
		Title:      strings.TrimSpace(e.Title),
		Summary:    clip(stripTags(firstNonEmpty(e.Description, e.Content, mdesc)), 500),
		// Full body as raw HTML for the in-app reader (#58): prefer content:encoded
		// (e.Content) over the teaser (e.Description), then the media description for
		// videos. Not stripped or clipped - the reader sanitizes it via DOMPurify.
		Content:      firstNonEmpty(e.Content, e.Description, plainToHTML(mdesc)),
		Author:       authorName(e),
		ThumbnailURL: thumbnail(e),
		DurationSec:  dur,
		// RSS <category> tags (#142): drives category-based auto-archive + the
		// "filter this out" card menu. gofeed maps both RSS <category> and Atom
		// <category term=...> into Categories.
		Categories:  e.Categories,
		PublishedAt: pub,
	}
	it.MediaType = classify(s, e, dur)
	// content_source provenance (#98): a feed that shipped a body is 'rss'; an
	// empty body stays pending ('') so the on-demand content endpoint can try a
	// readability fetch the first time the item is opened.
	if it.Content != "" {
		it.ContentSource = store.ContentSourceRSS
	}
	return it
}

// classify buckets an item into short | long | article | audio | live so the
// session builder can weight and estimate it. Heuristic, refined over time.
func classify(s store.Source, e *gofeed.Item, dur int) string {
	if s.Kind == "podcast" || hasEnclosureType(e, "audio") {
		return "audio"
	}
	if s.Kind == "youtube" || hasEnclosureType(e, "video") {
		return media.VideoType("", e.Link, dur, 0)
	}
	return "article"
}

func durationSeconds(e *gofeed.Item) int {
	if e.ITunesExt != nil && e.ITunesExt.Duration != "" {
		return parseDuration(e.ITunesExt.Duration)
	}
	// media:content duration lives in extensions
	if m, ok := e.Extensions["media"]; ok {
		if grp, ok := m["group"]; ok { // media:group (rename-bug fix)
			for _, g := range grp {
				if c, ok := g.Children["content"]; ok {
					for _, ch := range c {
						if d := ch.Attrs["duration"]; d != "" {
							if v, err := strconv.Atoi(d); err == nil {
								return v
							}
						}
					}
				}
			}
		}
	}
	return 0
}

// parseDuration handles both "HH:MM:SS"/"MM:SS" and a raw seconds integer, the
// two forms itunes:duration appears in.
func parseDuration(s string) int {
	s = strings.TrimSpace(s)
	if !strings.Contains(s, ":") {
		if v, err := strconv.Atoi(s); err == nil {
			return v
		}
		return 0
	}
	parts := strings.Split(s, ":")
	secs := 0
	for _, p := range parts {
		v, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil {
			return 0
		}
		secs = secs*60 + v
	}
	return secs
}

func hasEnclosureType(e *gofeed.Item, prefix string) bool {
	for _, enc := range e.Enclosures {
		if strings.HasPrefix(enc.Type, prefix) {
			return true
		}
	}
	return false
}

func authorName(e *gofeed.Item) string {
	if e.Author != nil && e.Author.Name != "" {
		return e.Author.Name
	}
	if len(e.Authors) > 0 {
		return e.Authors[0].Name
	}
	return ""
}

func thumbnail(e *gofeed.Item) string {
	if e.Image != nil && e.Image.URL != "" {
		return e.Image.URL
	}
	if m, ok := e.Extensions["media"]; ok {
		if grp, ok := m["group"]; ok { // media:group (rename-bug fix)
			for _, g := range grp {
				if th, ok := g.Children["thumbnail"]; ok {
					for _, t := range th {
						if u := t.Attrs["url"]; u != "" {
							return u
						}
					}
				}
			}
		}
		if th, ok := m["thumbnail"]; ok {
			for _, t := range th {
				if u := t.Attrs["url"]; u != "" {
					return u
				}
			}
		}
	}
	for _, enc := range e.Enclosures {
		if strings.HasPrefix(enc.Type, "image") {
			return enc.URL
		}
	}
	return ""
}

// mediaGroupDescription pulls media:group>media:description (the YouTube video
// description), which gofeed doesn't surface via Content/Description. Plain text.
func mediaGroupDescription(e *gofeed.Item) string {
	m, ok := e.Extensions["media"]
	if !ok {
		return ""
	}
	grp, ok := m["group"]
	if !ok {
		return ""
	}
	for _, g := range grp {
		for _, d := range g.Children["description"] {
			if v := strings.TrimSpace(d.Value); v != "" {
				return v
			}
		}
	}
	return ""
}

// plainToHTML turns a plain-text block (e.g. a YouTube description) into safe HTML
// for the reader: HTML-escaped, with line breaks preserved as <br>. Empty in, empty
// out (so it stays a clean fallback in firstNonEmpty).
func plainToHTML(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	return "<p>" + strings.ReplaceAll(html.EscapeString(s), "\n", "<br>") + "</p>"
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
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return strings.TrimSpace(s[:n]) + "..."
}

// stripTags removes HTML tags for a plain-text summary (feeds often ship HTML
// descriptions). Deliberately simple - not a sanitizer, just a de-tagger.
func stripTags(s string) string {
	var b strings.Builder
	depth := 0
	for _, r := range s {
		switch r {
		case '<':
			depth++
		case '>':
			if depth > 0 {
				depth--
			}
		default:
			if depth == 0 {
				b.WriteRune(r)
			}
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// ResolveSocial turns what a person pastes for a Bluesky, Substack or Medium
// source (#197) into a feed URL, name and avatar, checking the feed is real.
func (ing *Ingester) ResolveSocial(ctx context.Context, kind, input string) (*social.Resolved, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	switch kind {
	case "bluesky":
		return ing.soc.ResolveBluesky(ctx, input)
	case "substack":
		host := social.SubstackHost(input)
		if host == "" {
			return nil, errors.New("that doesn't look like a Substack publication")
		}
		return ing.peekFeed(ctx, kind, "https://"+host+"/feed", "https://"+host)
	case "medium":
		feedURL := social.MediumFeedURL(input)
		if feedURL == "" {
			return nil, errors.New("that doesn't look like a Medium profile or publication")
		}
		return ing.peekFeed(ctx, kind, feedURL, strings.Replace(feedURL, "/feed", "", 1))
	case "tumblr":
		host := social.TumblrHost(input)
		if host == "" {
			return nil, errors.New("that doesn't look like a Tumblr blog")
		}
		r, err := ing.peekFeed(ctx, kind, "https://"+host+"/rss", "https://"+host+"/")
		if err != nil {
			return nil, err
		}
		if r.IconURL == "" {
			r.IconURL = social.TumblrAvatar(host)
		}
		return r, nil
	}
	return nil, errors.New("unknown source type " + kind)
}

func (ing *Ingester) peekFeed(ctx context.Context, kind, feedURL, home string) (*social.Resolved, error) {
	feed, err := ing.parser.ParseURLWithContext(feedURL, ctx)
	if err != nil {
		return nil, errors.New("couldn't read " + feedURL + ": " + err.Error())
	}
	r := &social.Resolved{Kind: kind, FeedURL: feedURL, Title: strings.TrimSpace(feed.Title), HomeURL: home}
	if feed.Image != nil {
		r.IconURL = feed.Image.URL
	}
	if feed.Link != "" {
		r.HomeURL = strings.SplitN(feed.Link, "?", 2)[0] // Medium tags its links with ?source=rss
	}
	return r, nil
}
