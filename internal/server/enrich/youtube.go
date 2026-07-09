package enrich

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
	"github.com/fisherevans/otium/internal/server/youtube"
)

// YouTube enriches video items with a duration the RSS feed never ships (#120/#123).
// It has two backends: when a Data API key is configured it reads duration from
// videos.list (authoritative, 1 quota unit) - the robust path. Without a key it
// falls back to scraping "lengthSeconds" out of the watch-page HTML, which is
// fragile (YouTube serves consent/bot interstitials to datacenter IPs that omit it)
// but keeps the no-key deployment working best-effort. The full backlog import
// (#122) is a separate concern; this fills duration for items we already have.
type YouTube struct {
	client *http.Client
	api    *youtube.Client // nil = watch-page scrape fallback
	log    *slog.Logger
}

func NewYouTube(log *slog.Logger, api *youtube.Client) *YouTube {
	return &YouTube{
		client: &http.Client{Timeout: 12 * time.Second},
		api:    api,
		log:    log,
	}
}

func (y *YouTube) Kind() string { return "youtube_metadata" }

func (y *YouTube) Wants(c store.EnrichCandidate) bool {
	if c.SourceKind != "youtube" || c.URL == "" || c.DurationSec > 0 {
		return false
	}
	// A live item has no fixed length; only the short/long buckets carry a duration.
	return c.MediaType == "short" || c.MediaType == "long"
}

var lengthRe = regexp.MustCompile(`"lengthSeconds":"(\d+)"`)

// commitDuration re-buckets short/long from the real length and stores it.
func (y *YouTube) commitDuration(ctx context.Context, db *store.DB, itemID int64, sec int) (Result, error) {
	mt := "long"
	if sec <= 90 {
		mt = "short"
	}
	if err := db.SetItemDuration(ctx, itemID, sec, mt); err != nil {
		return Result{Retryable: true}, err // DB hiccup - safe to retry
	}
	return Result{}, nil
}

func (y *YouTube) Enrich(ctx context.Context, db *store.DB, c store.EnrichCandidate) (Result, error) {
	if y.api != nil {
		return y.enrichAPI(ctx, db, c)
	}
	return y.enrichScrape(ctx, db, c)
}

// enrichAPI reads duration from the Data API (videos.list) - the authoritative path.
func (y *YouTube) enrichAPI(ctx context.Context, db *store.DB, c store.EnrichCandidate) (Result, error) {
	vid := videoIDFromURL(c.URL)
	if vid == "" {
		return Result{Retryable: false}, errors.New("no video id in url")
	}
	sec, err := y.api.VideoDuration(ctx, vid)
	if err != nil {
		var te *youtube.TransientError
		if errors.As(err, &te) {
			return Result{Retryable: true, Cooldown: defaultCooldwn}, err // quota/5xx/network
		}
		return Result{Retryable: false}, err
	}
	if sec <= 0 {
		// The API returned no duration: the video is private, removed, or an
		// upcoming/live item with no fixed length. Nothing to retry.
		return Result{Retryable: false}, errors.New("no duration from api (private/removed/live)")
	}
	return y.commitDuration(ctx, db, c.ID, sec)
}

// videoIDFromURL extracts the video id from a watch, youtu.be, or /shorts/ URL.
func videoIDFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if v := u.Query().Get("v"); v != "" {
		return v
	}
	host := strings.TrimPrefix(strings.ToLower(u.Host), "www.")
	seg := strings.Split(strings.Trim(u.Path, "/"), "/")
	if host == "youtu.be" && len(seg) >= 1 {
		return seg[0]
	}
	if len(seg) >= 2 && seg[0] == "shorts" {
		return seg[1]
	}
	return ""
}

func (y *YouTube) enrichScrape(ctx context.Context, db *store.DB, c store.EnrichCandidate) (Result, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.URL, nil)
	if err != nil {
		return Result{Retryable: false}, err // a malformed URL won't fix itself
	}
	// A normal desktop UA gets the full watch page (with the player JSON we parse).
	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) otium/1.0")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	resp, err := y.client.Do(req)
	if err != nil {
		return Result{Retryable: true}, err // network / timeout / DNS - transient
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusTooManyRequests:
		return Result{Retryable: true, Cooldown: retryAfter(resp, defaultCooldwn)}, errors.New("youtube 429 rate limited")
	case resp.StatusCode >= 500:
		return Result{Retryable: true}, fmt.Errorf("youtube http %d", resp.StatusCode)
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusForbidden:
		return Result{Retryable: false}, fmt.Errorf("youtube http %d (video gone/private)", resp.StatusCode)
	case resp.StatusCode != http.StatusOK:
		return Result{Retryable: true}, fmt.Errorf("youtube http %d", resp.StatusCode)
	}

	// Cap the read: the length is near the top of the player config, well under 4MB.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return Result{Retryable: true}, err
	}
	m := lengthRe.FindSubmatch(body)
	if m == nil {
		// A 200 with no lengthSeconds means the page shape changed or it's not a
		// normal video (members-only, removed). No point retrying - mark it done-less.
		return Result{Retryable: false}, errors.New("no duration in watch page")
	}
	sec, err := strconv.Atoi(string(m[1]))
	if err != nil || sec <= 0 {
		return Result{Retryable: false}, errors.New("bad duration in watch page")
	}

	// Re-bucket short vs long from the real length (URL-detected shorts already are
	// short; a plain video under ~90s becomes short too).
	mt := "long"
	if sec <= 90 {
		mt = "short"
	}
	if err := db.SetItemDuration(ctx, c.ID, sec, mt); err != nil {
		return Result{Retryable: true}, err // DB hiccup - safe to retry
	}
	return Result{}, nil
}

// retryAfter reads a Retry-After header (seconds), falling back to def.
func retryAfter(resp *http.Response, def time.Duration) time.Duration {
	if v := resp.Header.Get("Retry-After"); v != "" {
		if s, err := strconv.Atoi(v); err == nil && s > 0 {
			return time.Duration(s) * time.Second
		}
	}
	return def
}
