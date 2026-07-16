package youtube

import (
	"context"
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/fisherevans/otium/internal/server/store"
)

// ImportResult reports one page of a backlog import.
type ImportResult struct {
	Imported      int    // genuinely new items upserted this page
	Seen          int    // videos on the page (new or already present)
	NextPageToken string // "" when the channel's uploads are fully walked
	ReachedCutoff bool   // hit the import bound (age and/or count) - stop paging
}

// ImportBound limits how deep a backlog import walks (#124), mirroring the resolved
// archive rule. Cutoff is the oldest publish time to keep (zero = no age limit /
// evergreen). MaxCount is keep-latest-N (0 = no count limit). Combine ("and" | "or")
// governs how the two limits combine when both are set. SeenBefore is how many
// videos prior pages already walked, so the count limit is over the source's
// absolute newest-first position, not per-page.
type ImportBound struct {
	Cutoff     time.Time
	MaxCount   int
	Combine    string
	SeenBefore int
}

// ImportPage runs ONE page of a source's backlog import: fetch a page of the
// channel's uploads (newest first), fill duration/stats, and upsert each video
// within the import bound as an item. Resumable - the caller persists NextPageToken
// (and the running Seen count) and calls again until NextPageToken is "" or
// ReachedCutoff is set. A zero-value bound means "no limit" (evergreen: import the
// whole history). Because the uploads playlist is newest-first, both the age and the
// count limits are monotonic across the walk, so once an item is beyond the bound
// everything after it is too and ReachedCutoff tells the caller to stop. Items
// dedupe against RSS-ingested ones via the same yt:video:<id> external id.
func (c *Client) ImportPage(ctx context.Context, db *store.DB, s store.Source, pageToken string, bound ImportBound) (ImportResult, error) {
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
	ageLimit := !bound.Cutoff.IsZero()
	countLimit := bound.MaxCount > 0
	for i, v := range vids {
		pos := bound.SeenBefore + i + 1 // 1-based newest-first position across pages
		tooOld := ageLimit && !v.PublishedAt.IsZero() && v.PublishedAt.Before(bound.Cutoff)
		overCount := countLimit && pos > bound.MaxCount
		var beyond bool
		switch {
		case ageLimit && countLimit && bound.Combine == "or":
			beyond = tooOld && overCount // OR keeps an item within EITHER limit
		case ageLimit && countLimit:
			beyond = tooOld || overCount // AND requires BOTH limits
		case countLimit:
			beyond = overCount
		default:
			beyond = tooOld
		}
		if beyond {
			res.ReachedCutoff = true
			continue // beyond the import bound - never eligible, skip
		}
		isNew, err := db.UpsertYouTubeItem(ctx, ToItem(v, s.ID))
		if err != nil {
			return res, err
		}
		if isNew {
			res.Imported++
		}
	}
	return res, nil
}

// ToItem maps a video to an otium item. External id matches the RSS ingest form
// (yt:video:<id>) so the RSS and Data-API paths dedupe onto the same row.
// media_type is bucketed from the real duration; body is the description (video
// items ship no other body). Shared by the backlog importer and the API-native
// ongoing ingest.
func ToItem(v Video, sourceID int64) *store.Item {
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
		AspectRatio:   v.AspectRatio,
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
