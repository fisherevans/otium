package conversation

import (
	"context"
	"net/url"
	"strings"
	"sync"
)

type bskyAuthor struct {
	Handle      string `json:"handle"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

type bskyEmbedView struct {
	Type   string `json:"$type"`
	Images []any  `json:"images"`
	// record#view: the quoted post (or a not-found/blocked stub).
	Record *bskyRecordView `json:"record"`
	// recordWithMedia#view nests the media beside the record.
	Media    *bskyEmbedView `json:"media"`
	External *struct {
		URI string `json:"uri"`
	} `json:"external"`
	Playlist string `json:"playlist"` // video
}

// bskyRecordView is app.bsky.embed.record#viewRecord, or the inner "record"
// of a recordWithMedia#view (which wraps one more level).
type bskyRecordView struct {
	Type   string          `json:"$type"`
	URI    string          `json:"uri"`
	Author bskyAuthor      `json:"author"`
	Value  bskyRecord      `json:"value"`
	Record *bskyRecordView `json:"record"` // recordWithMedia: record.record
	Likes  int             `json:"likeCount"`
	Reply  int             `json:"replyCount"`
	Embeds []bskyEmbedView `json:"embeds"`
}

type bskyRecord struct {
	Text      string `json:"text"`
	CreatedAt string `json:"createdAt"`
}

type bskyPostView struct {
	URI         string         `json:"uri"`
	Author      bskyAuthor     `json:"author"`
	Record      bskyRecord     `json:"record"`
	Embed       *bskyEmbedView `json:"embed"`
	LikeCount   int            `json:"likeCount"`
	RepostCount int            `json:"repostCount"`
	ReplyCount  int            `json:"replyCount"`
	QuoteCount  int            `json:"quoteCount"`
}

type bskyThreadNode struct {
	Type    string           `json:"$type"`
	Post    *bskyPostView    `json:"post"`
	Replies []bskyThreadNode `json:"replies"`
}

// BskyPostURL is the post's web address: https://bsky.app/profile/<handle>/post/<rkey>.
func BskyPostURL(handle, uri string) string {
	rkey := uri[strings.LastIndex(uri, "/")+1:]
	if handle == "" || rkey == "" {
		return ""
	}
	return "https://bsky.app/profile/" + handle + "/post/" + rkey
}

func (s *Service) bluesky(ctx context.Context, uri string) (*Conversation, error) {
	var thread struct {
		Thread bskyThreadNode `json:"thread"`
	}
	var quotes struct {
		Posts []bskyPostView `json:"posts"`
	}
	var qErr error
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		q := url.Values{"uri": {uri}, "limit": {"25"}}
		qErr = s.getJSON(ctx, s.cfg.BskyBase+"/app.bsky.feed.getQuotes?"+q.Encode(), &quotes)
	}()
	q := url.Values{"uri": {uri}, "depth": {"1"}, "parentHeight": {"0"}}
	err := s.getJSON(ctx, s.cfg.BskyBase+"/app.bsky.feed.getPostThread?"+q.Encode(), &thread)
	wg.Wait()
	if err != nil {
		return nil, err
	}
	p := thread.Thread.Post
	if p == nil {
		return nil, ErrUnsupported // deleted or blocked
	}
	conv := &Conversation{
		URL:    BskyPostURL(p.Author.Handle, p.URI),
		Counts: Counts{Likes: p.LikeCount, Reposts: p.RepostCount, Replies: p.ReplyCount, Quotes: p.QuoteCount},
	}
	for _, n := range thread.Thread.Replies {
		if n.Post == nil || !strings.HasSuffix(n.Type, "#threadViewPost") {
			continue // notFoundPost / blockedPost
		}
		conv.Replies = append(conv.Replies, bskyComment(*n.Post))
	}
	mostLiked(conv.Replies)
	// Quotes are secondary: a failure there still shows the replies.
	if qErr == nil {
		for _, qp := range quotes.Posts {
			conv.Quotes = append(conv.Quotes, bskyComment(qp))
		}
		mostLiked(conv.Quotes)
	}
	conv.Quoted = bskyQuoted(p.Embed)
	return conv, nil
}

func bskyComment(p bskyPostView) Comment {
	return Comment{
		Author:      firstNonEmpty(p.Author.DisplayName, p.Author.Handle),
		Handle:      p.Author.Handle,
		AvatarURL:   p.Author.Avatar,
		Text:        clipText(p.Record.Text, 1200),
		URL:         BskyPostURL(p.Author.Handle, p.URI),
		Likes:       p.LikeCount,
		Replies:     p.ReplyCount,
		Media:       bskyMedia(p.Embed),
		PublishedAt: parseTime(p.Record.CreatedAt),
	}
}

// bskyQuoted extracts the post an embed quotes, if any.
func bskyQuoted(e *bskyEmbedView) *Comment {
	if e == nil || e.Record == nil {
		return nil
	}
	r := e.Record
	if strings.HasPrefix(e.Type, "app.bsky.embed.recordWithMedia") && r.Record != nil {
		r = r.Record
	}
	if !strings.HasSuffix(r.Type, "#viewRecord") {
		return nil // not found, blocked, a feed generator or a list
	}
	media := ""
	if len(r.Embeds) > 0 {
		media = bskyMedia(&r.Embeds[0])
	}
	return &Comment{
		Author:      firstNonEmpty(r.Author.DisplayName, r.Author.Handle),
		Handle:      r.Author.Handle,
		AvatarURL:   r.Author.Avatar,
		Text:        clipText(r.Value.Text, 1200),
		URL:         BskyPostURL(r.Author.Handle, r.URI),
		Likes:       r.Likes,
		Replies:     r.Reply,
		Media:       media,
		PublishedAt: parseTime(r.Value.CreatedAt),
	}
}

func bskyMedia(e *bskyEmbedView) string {
	if e == nil {
		return ""
	}
	if e.Media != nil {
		return bskyMedia(e.Media)
	}
	switch {
	case len(e.Images) > 0:
		return "image"
	case e.Playlist != "":
		return "video"
	case e.External != nil:
		return "link"
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
