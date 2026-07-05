// Package fulltext fetches an article URL and extracts its readable body with
// go-readability, for items whose feed shipped no full content (#98). It is used
// only by the on-demand content endpoint, never on the ingest or ranking path,
// so a slow or failing fetch can never stall a session build.
//
// The contract is deliberately forgiving: Extract distinguishes "here is the
// article" from "this isn't extractable" (video, paywall, JS-only, network
// error, non-HTML) and returns the latter as (","", false, nil) rather than an
// error. The caller marks such items 'external' and offers "open original".
package fulltext

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	readability "github.com/go-shiori/go-readability"
)

const (
	// defaultTimeout bounds a single fetch. Short by design - the user is waiting
	// on the reader, and a slow site should fall back to "open original" fast.
	defaultTimeout = 10 * time.Second
	// defaultMaxBytes caps the HTML we read into memory. Articles are well under
	// this; the cap stops a pathological page (or a mislabeled binary) from
	// ballooning the process.
	defaultMaxBytes = 4 << 20 // 4 MB
	// userAgent identifies otium politely; some sites 403 an empty UA.
	userAgent = "otium/0.1 (+https://otium.fisher.sh)"
	// minTextLength is the floor on extracted plain-text length (chars) to accept a
	// page as a real article. go-readability is lenient - it will happily distill a
	// nav-only or teaser page down to a sentence - and returning that as "full text"
	// is worse than falling back to "open original". Real articles clear this by an
	// order of magnitude; a stub page doesn't. Tunable.
	minTextLength = 250
)

// Fetcher fetches and extracts article bodies. Safe for concurrent use (the
// underlying http.Client is). Construct with New.
type Fetcher struct {
	client   *http.Client
	ua       string
	maxBytes int64
}

// New returns a Fetcher with sane timeout, size cap, and user agent.
func New() *Fetcher {
	return &Fetcher{
		client:   &http.Client{Timeout: defaultTimeout},
		ua:       userAgent,
		maxBytes: defaultMaxBytes,
	}
}

// Extract fetches rawURL and returns the readable article body as HTML. ok is
// false when the URL isn't an extractable article - a non-HTML content type, a
// non-200 status, a network error, or content readability can't distill. In
// those cases html is "" and err is nil: "not an article" is a normal outcome,
// not a failure. err is reserved for a genuinely unexpected condition (currently
// none - kept in the signature so a future hard failure can surface distinctly).
func (f *Fetcher) Extract(ctx context.Context, rawURL string) (html string, ok bool, err error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", false, nil
	}
	u, perr := url.Parse(rawURL)
	if perr != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "", false, nil
	}

	req, rerr := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if rerr != nil {
		return "", false, nil
	}
	req.Header.Set("User-Agent", f.ua)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	resp, derr := f.client.Do(req)
	if derr != nil {
		return "", false, nil // network/timeout -> external, not a server error
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", false, nil // 403/404/paywall/redirect-loop -> not extractable
	}
	if ct := resp.Header.Get("Content-Type"); ct != "" && !strings.Contains(strings.ToLower(ct), "html") {
		return "", false, nil // video/pdf/json/etc -> not an article
	}

	body, berr := io.ReadAll(io.LimitReader(resp.Body, f.maxBytes))
	if berr != nil {
		return "", false, nil
	}

	article, aerr := readability.FromReader(bytes.NewReader(body), u)
	if aerr != nil {
		return "", false, nil
	}
	content := strings.TrimSpace(article.Content)
	if content == "" {
		return "", false, nil
	}

	// Post-process (#99): strip nav/skip/footer chrome readability leaves behind,
	// then gate on the cleaned body. cleanArticleHTML returns the clean HTML plus
	// its plain text; isArticleLike rejects media-dominated / embed-built /
	// markup-heavy pages so they resolve to 'external' rather than a broken text
	// render. A normal article with a few inline images clears the gate.
	cleaned, plain := cleanArticleHTML(content)
	if cleaned == "" || !isArticleLike(cleaned, plain) {
		return "", false, nil
	}
	return cleaned, true, nil
}
