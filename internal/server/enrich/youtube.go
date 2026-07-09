package enrich

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// YouTube enriches video items with a duration the RSS feed never ships (#120/#123).
// The watch page exposes "lengthSeconds":"N" (and an itemprop=duration), so a plain
// authenticated-free GET + parse gets it - no Data API key. The full backlog import
// (a channel's whole history) is a separate concern (#122); this fills duration for
// the items we already have, out of band, so the length scoring facet has data.
type YouTube struct {
	client *http.Client
	log    *slog.Logger
}

func NewYouTube(log *slog.Logger) *YouTube {
	return &YouTube{
		client: &http.Client{Timeout: 12 * time.Second},
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

func (y *YouTube) Enrich(ctx context.Context, db *store.DB, c store.EnrichCandidate) (Result, error) {
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
