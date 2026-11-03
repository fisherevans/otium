package conversation

import (
	"context"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"github.com/fisherevans/otium/internal/server/richtext"
)

type bskyPostView struct {
	URI         string                  `json:"uri"`
	Author      richtext.BskyAuthor     `json:"author"`
	Record      richtext.BskyRecord     `json:"record"`
	Embed       *richtext.BskyEmbedView `json:"embed"`
	LikeCount   int                     `json:"likeCount"`
	RepostCount int                     `json:"repostCount"`
	ReplyCount  int                     `json:"replyCount"`
	QuoteCount  int                     `json:"quoteCount"`
}

type bskyThreadNode struct {
	Type    string           `json:"$type"`
	Post    *bskyPostView    `json:"post"`
	Replies []bskyThreadNode `json:"replies"`
}

// threadDepth is how deep the reply tree is fetched (#207): a reply, the replies
// to it, and one more level - enough to read a thread as a thread without
// pulling a whole pile-on.
const threadDepth = 3

// BskyPostURL is the post's web address: https://bsky.app/profile/<handle>/post/<rkey>.
func BskyPostURL(handle, uri string) string { return richtext.BskyPostURL(handle, uri) }

func (s *Service) bluesky(ctx context.Context, uri string) (*Conversation, error) {
	var thread struct {
		Thread bskyThreadNode `json:"thread"`
	}
	var quotes struct {
		Posts  []bskyPostView `json:"posts"`
		Cursor string         `json:"cursor"`
	}
	var qErr error
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		q := url.Values{"uri": {uri}, "limit": {strconv.Itoa(QuotesPage)}}
		qErr = s.getJSON(ctx, s.cfg.BskyBase+"/app.bsky.feed.getQuotes?"+q.Encode(), &quotes)
	}()
	q := url.Values{"uri": {uri}, "depth": {strconv.Itoa(threadDepth)}, "parentHeight": {"0"}}
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
	conv.Replies = bskyReplies(thread.Thread.Replies, threadDepth)
	// Quotes are secondary: a failure there still shows the replies.
	if qErr == nil {
		for _, qp := range quotes.Posts {
			conv.Quotes = append(conv.Quotes, bskyComment(qp))
		}
		mostLiked(conv.Quotes)
		if len(quotes.Posts) >= QuotesPage {
			conv.quotesCursor = quotes.Cursor
		}
	}
	conv.Quoted = bskyQuoted(p.Embed)
	return conv, nil
}

// bskyReplies turns a thread level into comments, most-liked first at every
// level, nesting the replies to each down to depth.
func bskyReplies(nodes []bskyThreadNode, depth int) []Comment {
	var out []Comment
	for _, n := range nodes {
		if n.Post == nil || !strings.HasSuffix(n.Type, "#threadViewPost") {
			continue // notFoundPost / blockedPost
		}
		c := bskyComment(*n.Post)
		if depth > 1 && len(n.Replies) > 0 {
			c.Children = bskyReplies(n.Replies, depth-1)
		} else if len(n.Replies) == 0 && n.Post.ReplyCount > 0 {
			// The thread was cut here (the depth limit sends no replies at all);
			// More("thread", c.ID) fetches what is below.
			c.MoreReplies = n.Post.ReplyCount
		}
		out = append(out, c)
	}
	mostLiked(out)
	return out
}

func bskyComment(p bskyPostView) Comment {
	body := richtext.BskyPost(p.Author, p.Record, p.Embed)
	return Comment{
		ID:          p.URI,
		Author:      firstNonEmpty(p.Author.DisplayName, p.Author.Handle),
		Handle:      p.Author.Handle,
		AvatarURL:   p.Author.Avatar,
		Text:        clipText(p.Record.Text, 1200),
		Segments:    clipSegments(body.Segments, 1200),
		URL:         BskyPostURL(p.Author.Handle, p.URI),
		Likes:       p.LikeCount,
		Replies:     p.ReplyCount,
		Media:       bskyMedia(body),
		Images:      body.Images,
		Link:        body.Link,
		Video:       body.Video,
		Quote:       body.Quote,
		PublishedAt: parseTime(p.Record.CreatedAt),
	}
}

// bskyQuoted extracts the post an embed quotes, if any.
func bskyQuoted(e *richtext.BskyEmbedView) *Comment {
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
	var att richtext.Post
	if len(r.Embeds) > 0 {
		b := richtext.BskyPost(r.Author, richtext.BskyRecord{}, &r.Embeds[0])
		media, att = bskyMedia(b), *b
	}
	return &Comment{
		Images:      att.Images,
		Link:        att.Link,
		Video:       att.Video,
		Author:      firstNonEmpty(r.Author.DisplayName, r.Author.Handle),
		Handle:      r.Author.Handle,
		AvatarURL:   r.Author.Avatar,
		Text:        clipText(r.Value.Text, 1200),
		Segments:    clipSegments(richtext.Segments(r.Value.Text, r.Value.Facets), 1200),
		URL:         BskyPostURL(r.Author.Handle, r.URI),
		Likes:       r.Likes,
		Replies:     r.Reply,
		Media:       media,
		PublishedAt: parseTime(r.Value.CreatedAt),
	}
}

// bskyMedia names what a post carries beyond its text.
func bskyMedia(p *richtext.Post) string {
	switch {
	case len(p.Images) > 0:
		return "image"
	case p.Video != nil:
		return "video"
	case p.Link != nil:
		return "link"
	case p.Quote != nil:
		return ""
	}
	return ""
}

// clipSegments keeps segments only when they carry a link and the text fits
// unclipped; otherwise the plain clipped Text is all a client needs.
func clipSegments(segs []richtext.Segment, n int) []richtext.Segment {
	linked := false
	for _, s := range segs {
		if s.Href != "" {
			linked = true
			break
		}
	}
	if !linked || len([]rune(strings.TrimSpace(richtext.Plain(segs)))) > n {
		return nil
	}
	return segs
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
