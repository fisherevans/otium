// Package youtube is a thin read-only client for the YouTube Data API v3, used to
// backfill a channel's full upload history (#122) - the RSS feed only exposes the
// ~15 most recent videos. API-key auth (public data only); quota is a non-issue at
// homelab volume (~1 unit per 50 videos, 10k/day). It fetches structured metadata
// the RSS never ships: duration and live view/like counts.
package youtube

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// baseURL is a var so tests can point it at a local server.
var baseURL = "https://www.googleapis.com/youtube/v3"

type Client struct {
	apiKey string
	http   *http.Client
}

func NewClient(apiKey string) *Client {
	return &Client{apiKey: apiKey, http: &http.Client{Timeout: 20 * time.Second}}
}

// Video is the subset of a video's metadata otium stores as an item.
type Video struct {
	ID           string
	Title        string
	Description  string
	PublishedAt  time.Time
	ThumbnailURL string
	DurationSec  int
	ViewCount    int64
	LikeCount    int64
}

// ChannelIDFromFeedURL pulls the UC... channel id out of a YouTube RSS feed_url
// (…/feeds/videos.xml?channel_id=UC…). Returns "" if it's not a channel feed.
func ChannelIDFromFeedURL(feedURL string) string {
	u, err := url.Parse(feedURL)
	if err != nil {
		return ""
	}
	id := u.Query().Get("channel_id")
	if strings.HasPrefix(id, "UC") {
		return id
	}
	return ""
}

// UploadsPlaylistID is the channel's auto-generated "all uploads" playlist: the UC
// channel prefix becomes UU. No API call needed.
func UploadsPlaylistID(channelID string) string {
	if !strings.HasPrefix(channelID, "UC") {
		return ""
	}
	return "UU" + channelID[2:]
}

// TransientError marks an error the caller should retry (network / 5xx / quota).
type TransientError struct{ err error }

func (e *TransientError) Error() string { return e.err.Error() }
func (e *TransientError) Unwrap() error { return e.err }

func (c *Client) get(ctx context.Context, endpoint string, params url.Values, out any) error {
	params.Set("key", c.apiKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/"+endpoint+"?"+params.Encode(), nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return &TransientError{err}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	switch {
	case resp.StatusCode == http.StatusOK:
		return json.Unmarshal(body, out)
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusForbidden:
		// 403 covers quotaExceeded (transient - resets daily) as well as a bad key.
		return &TransientError{fmt.Errorf("youtube api %d: %s", resp.StatusCode, snippet(body))}
	case resp.StatusCode >= 500:
		return &TransientError{fmt.Errorf("youtube api %d", resp.StatusCode)}
	default:
		return fmt.Errorf("youtube api %d: %s", resp.StatusCode, snippet(body))
	}
}

// ListUploadsPage returns one page (up to 50) of the uploads playlist as Videos
// with everything but duration/stats (those come from VideoDetails), plus the next
// page token ("" when done).
func (c *Client) ListUploadsPage(ctx context.Context, playlistID, pageToken string) ([]Video, string, error) {
	p := url.Values{}
	p.Set("part", "snippet,contentDetails")
	p.Set("playlistId", playlistID)
	p.Set("maxResults", "50")
	if pageToken != "" {
		p.Set("pageToken", pageToken)
	}
	var out struct {
		NextPageToken string `json:"nextPageToken"`
		Items         []struct {
			Snippet struct {
				Title       string `json:"title"`
				Description string `json:"description"`
				Thumbnails  map[string]struct {
					URL string `json:"url"`
				} `json:"thumbnails"`
				ResourceID struct {
					VideoID string `json:"videoId"`
				} `json:"resourceId"`
			} `json:"snippet"`
			ContentDetails struct {
				VideoID          string `json:"videoId"`
				VideoPublishedAt string `json:"videoPublishedAt"`
			} `json:"contentDetails"`
		} `json:"items"`
	}
	if err := c.get(ctx, "playlistItems", p, &out); err != nil {
		return nil, "", err
	}
	vids := make([]Video, 0, len(out.Items))
	for _, it := range out.Items {
		id := it.ContentDetails.VideoID
		if id == "" {
			id = it.Snippet.ResourceID.VideoID
		}
		if id == "" || strings.EqualFold(it.Snippet.Title, "Private video") || strings.EqualFold(it.Snippet.Title, "Deleted video") {
			continue
		}
		pub, _ := time.Parse(time.RFC3339, it.ContentDetails.VideoPublishedAt)
		vids = append(vids, Video{
			ID:           id,
			Title:        it.Snippet.Title,
			Description:  it.Snippet.Description,
			PublishedAt:  pub,
			ThumbnailURL: bestThumb(it.Snippet.Thumbnails),
		})
	}
	return vids, out.NextPageToken, nil
}

// FillDetails populates DurationSec + view/like counts for up to 50 videos in one
// videos.list call, matched back by id.
func (c *Client) FillDetails(ctx context.Context, vids []Video) error {
	if len(vids) == 0 {
		return nil
	}
	ids := make([]string, len(vids))
	for i, v := range vids {
		ids[i] = v.ID
	}
	p := url.Values{}
	p.Set("part", "contentDetails,statistics")
	p.Set("id", strings.Join(ids, ","))
	p.Set("maxResults", "50")
	var out struct {
		Items []struct {
			ID             string `json:"id"`
			ContentDetails struct {
				Duration string `json:"duration"`
			} `json:"contentDetails"`
			Statistics struct {
				ViewCount string `json:"viewCount"`
				LikeCount string `json:"likeCount"`
			} `json:"statistics"`
		} `json:"items"`
	}
	if err := c.get(ctx, "videos", p, &out); err != nil {
		return err
	}
	byID := map[string]int{}
	for i := range vids {
		byID[vids[i].ID] = i
	}
	for _, it := range out.Items {
		i, ok := byID[it.ID]
		if !ok {
			continue
		}
		vids[i].DurationSec = ParseISODuration(it.ContentDetails.Duration)
		vids[i].ViewCount = atoi64(it.Statistics.ViewCount)
		vids[i].LikeCount = atoi64(it.Statistics.LikeCount)
	}
	return nil
}

// ParseISODuration parses an ISO-8601 duration (PT#H#M#S, YouTube's contentDetails
// form) into seconds. Days/weeks aren't used by YouTube video durations.
func ParseISODuration(s string) int {
	if !strings.HasPrefix(s, "PT") {
		return 0
	}
	s = s[2:]
	total, num := 0, 0
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
			num = num*10 + int(r-'0')
		case r == 'H':
			total += num * 3600
			num = 0
		case r == 'M':
			total += num * 60
			num = 0
		case r == 'S':
			total += num
			num = 0
		default:
			return total
		}
	}
	return total
}

func bestThumb(t map[string]struct {
	URL string `json:"url"`
}) string {
	for _, k := range []string{"maxres", "standard", "high", "medium", "default"} {
		if v, ok := t[k]; ok && v.URL != "" {
			return v.URL
		}
	}
	return ""
}

func atoi64(s string) int64 { v, _ := strconv.ParseInt(s, 10, 64); return v }

func snippet(b []byte) string {
	if len(b) > 200 {
		return string(b[:200])
	}
	return string(b)
}
