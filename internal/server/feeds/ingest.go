// Package feeds fetches a source's RSS/Atom feed and normalizes each entry into
// a store.Item. It handles plain RSS, YouTube channel feeds (Atom + media
// namespace), and podcasts (itunes:duration), collapsing them into one shape so
// the rest of otium never cares where an item came from.
package feeds

import (
	"context"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/mmcdole/gofeed"

	"github.com/fisherevans/otium/internal/server/store"
)

type Ingester struct {
	db     *store.DB
	parser *gofeed.Parser
	log    *slog.Logger
}

func NewIngester(db *store.DB, log *slog.Logger) *Ingester {
	p := gofeed.NewParser()
	p.UserAgent = "otium/0.1 (+https://otium.fisher.sh)"
	return &Ingester{db: db, parser: p, log: log}
}

// FetchSource pulls one source's feed and upserts its items. Returns the count
// of newly inserted items. A fetch/parse error is recorded on the source and
// returned, but is not fatal to a batch run.
func (ing *Ingester) FetchSource(ctx context.Context, s store.Source) (int, error) {
	fctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	feed, err := ing.parser.ParseURLWithContext(s.FeedURL, fctx)
	if err != nil {
		_ = ing.db.MarkFetched(ctx, s.ID, err.Error())
		return 0, err
	}

	fresh := 0
	for _, e := range feed.Items {
		it := normalize(s, e)
		if it == nil {
			continue
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
	_ = ing.db.MarkFetched(ctx, s.ID, "")
	return fresh, nil
}

// FetchAll fetches every non-archived source for a user, sequentially (homelab
// scale; no need to hammer). Returns total new items.
func (ing *Ingester) FetchAll(ctx context.Context, userID int64) (int, error) {
	sources, err := ing.db.SourcesToFetch(ctx, userID)
	if err != nil {
		return 0, err
	}
	total := 0
	for _, s := range sources {
		n, err := ing.FetchSource(ctx, s)
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
	it := &store.Item{
		SourceID:   s.ID,
		ExternalID: extID,
		URL:        e.Link,
		Title:      strings.TrimSpace(e.Title),
		Summary:    clip(stripTags(firstNonEmpty(e.Description, e.Content)), 500),
		// Full body as raw HTML for the in-app reader (#58): prefer content:encoded
		// (e.Content) over the teaser (e.Description). Not stripped or clipped - the
		// reader sanitizes it client-side via DOMPurify.
		Content:      firstNonEmpty(e.Content, e.Description),
		Author:       authorName(e),
		ThumbnailURL: thumbnail(e),
		DurationSec:  dur,
		PublishedAt:  pub,
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
		// YouTube Shorts carry a /shorts/ URL - an exact type signal even though
		// the RSS feed never ships a duration (#117).
		if strings.Contains(e.Link, "/shorts/") {
			return "short"
		}
		if dur > 0 && dur <= 90 {
			return "short"
		}
		return "long"
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
