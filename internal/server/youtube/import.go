package youtube

import (
	"context"
	"fmt"
	"html"
	"strings"

	"github.com/fisherevans/otium/internal/server/store"
)

// ImportResult reports one page of a backlog import.
type ImportResult struct {
	Imported      int    // genuinely new items upserted this page
	Seen          int    // videos on the page (new or already present)
	NextPageToken string // "" when the channel's uploads are fully walked
}

// ImportPage runs ONE page of a source's backlog import: fetch a page of the
// channel's uploads, fill duration/stats, upsert each as an item. Resumable - the
// caller persists NextPageToken and calls again with it until it's "". Items dedupe
// against RSS-ingested ones via the same yt:video:<id> external id, so importing a
// source that RSS already partly covers is safe (existing rows are left untouched).
func (c *Client) ImportPage(ctx context.Context, db *store.DB, s store.Source, pageToken string) (ImportResult, error) {
	channelID := ChannelIDFromFeedURL(s.FeedURL)
	if channelID == "" {
		return ImportResult{}, fmt.Errorf("source %d is not a youtube channel feed: %s", s.ID, s.FeedURL)
	}
	vids, next, err := c.ListUploadsPage(ctx, UploadsPlaylistID(channelID), pageToken)
	if err != nil {
		return ImportResult{}, err
	}
	if err := c.FillDetails(ctx, vids); err != nil {
		return ImportResult{}, err
	}
	res := ImportResult{Seen: len(vids), NextPageToken: next}
	for _, v := range vids {
		isNew, err := db.UpsertItem(ctx, toItem(v, s.ID))
		if err != nil {
			return res, err
		}
		if isNew {
			res.Imported++
		}
	}
	return res, nil
}

// toItem maps an imported video to an otium item. External id matches the RSS
// ingest form (yt:video:<id>) so the two sources dedupe. media_type is bucketed
// from the real duration; body is the description (video items ship no other body).
func toItem(v Video, sourceID int64) *store.Item {
	mt := "long"
	if v.DurationSec > 0 && v.DurationSec <= 90 {
		mt = "short"
	}
	content := ""
	if d := strings.TrimSpace(v.Description); d != "" {
		content = "<p>" + strings.ReplaceAll(html.EscapeString(d), "\n", "<br>") + "</p>"
	}
	src := ""
	if content != "" {
		src = store.ContentSourceRSS
	}
	return &store.Item{
		SourceID:      sourceID,
		ExternalID:    "yt:video:" + v.ID,
		URL:           "https://www.youtube.com/watch?v=" + v.ID,
		Title:         v.Title,
		Summary:       clip(v.Description, 500),
		Content:       content,
		ContentSource: src,
		Author:        "",
		ThumbnailURL:  v.ThumbnailURL,
		MediaType:     mt,
		DurationSec:   v.DurationSec,
		PublishedAt:   v.PublishedAt,
	}
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return strings.TrimSpace(s[:n]) + "…"
}
