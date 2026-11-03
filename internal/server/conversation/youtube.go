package conversation

import (
	"context"
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var ytID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// YouTubeVideoID extracts the video id from a watch, youtu.be or /shorts/ URL.
func YouTubeVideoID(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	host := strings.TrimPrefix(strings.ToLower(u.Host), "www.")
	host = strings.TrimPrefix(host, "m.")
	seg := strings.Split(strings.Trim(u.Path, "/"), "/")
	id := ""
	switch {
	case host == "youtu.be" && len(seg) >= 1:
		id = seg[0]
	case host == "youtube.com" && u.Query().Get("v") != "":
		id = u.Query().Get("v")
	case host == "youtube.com" && len(seg) >= 2 && (seg[0] == "shorts" || seg[0] == "live"):
		id = seg[1]
	}
	if !ytID.MatchString(id) {
		return ""
	}
	return id
}

type ytThreads struct {
	Items []struct {
		Snippet struct {
			TotalReplyCount int `json:"totalReplyCount"`
			TopLevelComment struct {
				ID      string `json:"id"`
				Snippet struct {
					AuthorDisplayName     string `json:"authorDisplayName"`
					AuthorProfileImageURL string `json:"authorProfileImageUrl"`
					TextDisplay           string `json:"textDisplay"`
					LikeCount             int    `json:"likeCount"`
					PublishedAt           string `json:"publishedAt"`
				} `json:"snippet"`
			} `json:"topLevelComment"`
		} `json:"snippet"`
	} `json:"items"`
}

type ytStats struct {
	Items []struct {
		Statistics struct {
			ViewCount    string `json:"viewCount"`
			LikeCount    string `json:"likeCount"`
			CommentCount string `json:"commentCount"`
		} `json:"statistics"`
	} `json:"items"`
}

// youtube reads the video's top comments (relevance order, then re-sorted by
// likes) and its statistics. Comments turned off is an empty conversation, not
// an error.
func (s *Service) youtube(ctx context.Context, videoID string) (*Conversation, error) {
	if videoID == "" {
		return nil, ErrUnsupported
	}
	watch := "https://www.youtube.com/watch?v=" + videoID
	conv := &Conversation{URL: watch}

	var stats ytStats
	q := url.Values{"part": {"statistics"}, "id": {videoID}, "key": {s.cfg.YouTubeKey}}
	if err := s.getJSON(ctx, s.cfg.YouTubeBase+"/videos?"+q.Encode(), &stats); err == nil && len(stats.Items) > 0 {
		st := stats.Items[0].Statistics
		conv.Counts.Likes = atoi(st.LikeCount)
		conv.Counts.Replies = atoi(st.CommentCount)
		conv.Counts.Views, _ = strconv.ParseInt(st.ViewCount, 10, 64)
	}

	var threads ytThreads
	q = url.Values{
		"part": {"snippet"}, "videoId": {videoID}, "order": {"relevance"},
		"maxResults": {"20"}, "textFormat": {"plainText"}, "key": {s.cfg.YouTubeKey},
	}
	if err := s.getJSON(ctx, s.cfg.YouTubeBase+"/commentThreads?"+q.Encode(), &threads); err != nil {
		var he *HTTPError
		if errors.As(err, &he) && he.Status == 403 && strings.Contains(he.Body, "commentsDisabled") {
			return conv, nil
		}
		return nil, err
	}
	for _, it := range threads.Items {
		c := it.Snippet.TopLevelComment
		sn := c.Snippet
		if strings.TrimSpace(sn.TextDisplay) == "" {
			continue
		}
		conv.Replies = append(conv.Replies, Comment{
			Author:      strings.TrimPrefix(sn.AuthorDisplayName, "@"),
			Handle:      sn.AuthorDisplayName,
			AvatarURL:   sn.AuthorProfileImageURL,
			Text:        clipText(sn.TextDisplay, 1200),
			URL:         watch + "&lc=" + url.QueryEscape(c.ID),
			Likes:       sn.LikeCount,
			Replies:     it.Snippet.TotalReplyCount,
			PublishedAt: parseTime(sn.PublishedAt),
		})
	}
	mostLiked(conv.Replies)
	return conv, nil
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
