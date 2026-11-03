package conversation

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// substackSlug is the post slug from a Substack post URL (/p/<slug>), on the
// publication's own host or a custom domain.
func substackSlug(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	seg := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(seg) >= 2 && seg[0] == "p" && seg[1] != "" {
		return seg[1]
	}
	return ""
}

type substackPost struct {
	ID            int64 `json:"id"`
	ReactionCount int   `json:"reaction_count"`
	CommentCount  int   `json:"comment_count"`
	Restacks      int   `json:"restacks"`
}

type substackComment struct {
	ID            int64             `json:"id"`
	Name          string            `json:"name"`
	Handle        string            `json:"handle"`
	PhotoURL      string            `json:"photo_url"`
	Body          string            `json:"body"`
	Date          string            `json:"date"`
	ReactionCount int               `json:"reaction_count"`
	ChildrenCount int               `json:"children_count"`
	Deleted       bool              `json:"deleted"`
	Children      []substackComment `json:"children"`
}

// substack reads the post's counts by slug, then its top-level comments. The
// public API is undocumented but stable: /api/v1/posts/<slug> and
// /api/v1/post/<id>/comments.
func (s *Service) substack(ctx context.Context, postURL string) (*Conversation, error) {
	host := hostOf(postURL)
	slug := substackSlug(postURL)
	if host == "" || slug == "" {
		return nil, ErrUnsupported
	}
	base := s.cfg.SubstackBase(host)
	var post substackPost
	if err := s.getJSON(ctx, base+"/api/v1/posts/"+url.PathEscape(slug), &post); err != nil {
		return nil, err
	}
	if post.ID == 0 {
		return nil, ErrUnsupported
	}
	var resp struct {
		Comments []substackComment `json:"comments"`
	}
	q := url.Values{"all_comments": {"true"}, "sort": {"best_first"}}
	if err := s.getJSON(ctx, fmt.Sprintf("%s/api/v1/post/%d/comments?%s", base, post.ID, q.Encode()), &resp); err != nil {
		return nil, err
	}
	conv := &Conversation{
		URL:    strings.TrimRight(postURL, "/") + "/comments",
		Counts: Counts{Likes: post.ReactionCount, Reposts: post.Restacks, Replies: post.CommentCount},
	}
	conv.Replies = substackComments(resp.Comments, postURL)
	return conv, nil
}

// substackComments turns a comment tree into comments, most-liked first at every
// level. With all_comments=true Substack sends the whole tree at once, so the
// paging (#209) is done over this, not upstream.
func substackComments(in []substackComment, postURL string) []Comment {
	var out []Comment
	for _, c := range in {
		if c.Deleted || strings.TrimSpace(c.Body) == "" {
			// A deleted comment's replies still stand; lift them a level.
			out = append(out, substackComments(c.Children, postURL)...)
			continue
		}
		out = append(out, Comment{
			ID:          strconv.FormatInt(c.ID, 10),
			Author:      firstNonEmpty(c.Name, c.Handle, "Reader"),
			Handle:      c.Handle,
			AvatarURL:   c.PhotoURL,
			Text:        clipText(c.Body, 1500),
			URL:         fmt.Sprintf("%s/comment/%d", strings.TrimRight(postURL, "/"), c.ID),
			Likes:       c.ReactionCount,
			Replies:     max(c.ChildrenCount, len(c.Children)),
			PublishedAt: parseTime(c.Date),
			Children:    substackComments(c.Children, postURL),
		})
	}
	mostLiked(out)
	return out
}
