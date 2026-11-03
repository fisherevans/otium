package conversation

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Paging (#209). The reader keeps the conversation going as you scroll: more
// top-level replies, the replies under a reply, more quotes, and who reposted.
//
// Bluesky's getPostThread and Substack's comments endpoint both send every
// top-level reply at once, so replies are paged here, over the cached full
// conversation: Get answers with the first RepliesPage and a cursor (an offset)
// for the rest. A thread is fetched three levels deep; a reply cut off at that
// depth, or with more than ChildrenShown replies of its own, carries
// MoreReplies, and More(kind "thread") loads them - a fresh getPostThread rooted
// at that reply on Bluesky, the cached tree on Substack. Quotes and reposts are
// paged upstream with the platform's own cursor (getQuotes, getRepostedBy).
//
// Every page is cached for the Service's TTL under its own key, failures for a
// minute, the same as Get.

const (
	// RepliesPage is how many top-level replies one page carries.
	RepliesPage = 20
	// ChildrenShown is how many replies a reply carries in a page; the rest are
	// its MoreReplies.
	ChildrenShown = 6
	// ThreadChildren is how many direct replies a "thread" page carries: the ones
	// a reader asked to see, so more of them than a page shows unasked.
	ThreadChildren = 50
	// QuotesPage and RepostsPage are the upstream page sizes.
	QuotesPage  = 25
	RepostsPage = 50
)

// Page kinds for More.
const (
	KindReplies = "replies"
	KindQuotes  = "quotes"
	KindReposts = "reposts"
	KindThread  = "thread"
)

// Person is someone who reposted (#209): a compact, quiet list in the reader.
type Person struct {
	Name      string `json:"name"`
	Handle    string `json:"handle,omitempty"`
	AvatarURL string `json:"avatar_url,omitempty"`
	URL       string `json:"url,omitempty"`
}

// Page is one more page of a conversation.
type Page struct {
	Kind   string    `json:"kind"`
	Items  []Comment `json:"items"`            // replies, quotes, or a thread's replies
	People []Person  `json:"people,omitempty"` // reposts
	// Cursor is the next page of the same kind; empty at the end.
	Cursor string `json:"cursor,omitempty"`
}

// ErrBadPage is a page request that cannot be answered: an unknown kind, a
// malformed cursor, or a kind the platform does not have.
var ErrBadPage = fmt.Errorf("no such page")

// firstPage is what Get answers: the first replies with a few under each, and
// cursors for what else there is.
func firstPage(full *Conversation) *Conversation {
	c := *full
	c.Replies = trimTree(full.Replies, RepliesPage, ChildrenShown)
	c.Cursors = map[string]string{}
	if len(full.Replies) > RepliesPage {
		c.Cursors[KindReplies] = strconv.Itoa(RepliesPage)
	}
	if full.quotesCursor != "" {
		c.Cursors[KindQuotes] = full.quotesCursor
	}
	if full.Platform == Bluesky && full.Counts.Reposts > 0 {
		c.Cursors[KindReposts] = ""
	}
	if len(c.Cursors) == 0 {
		c.Cursors = nil
	}
	return &c
}

// trimTree keeps the first n comments, each with at most kids replies, and
// theirs with at most DeeperShown, down to ThreadLevels levels in all, counting
// what it leaves out as MoreReplies. Substack sends whole trees (an ACX open
// thread's first twenty comments carry over a thousand replies), so a page is
// cut to a readable shape and the rest loads per reply.
func trimTree(cs []Comment, n, kids int) []Comment {
	return trimLevels(cs, n, kids, ThreadLevels)
}

// ThreadLevels is how many levels of a thread one page carries, and
// DeeperShown how many replies each reply below the first level keeps.
const (
	ThreadLevels = 3
	DeeperShown  = 3
)

func trimLevels(cs []Comment, n, kids, levels int) []Comment {
	if len(cs) > n {
		cs = cs[:n]
	}
	out := make([]Comment, len(cs))
	for i, c := range cs {
		switch {
		case len(c.Children) == 0:
		case levels <= 1:
			c.MoreReplies = max(c.MoreReplies, len(c.Children))
			c.Children = nil
		default:
			if hidden := len(c.Children) - kids; hidden > 0 {
				c.MoreReplies = max(c.MoreReplies, hidden)
			}
			c.Children = trimLevels(c.Children, kids, DeeperShown, levels-1)
		}
		out[i] = c
	}
	return out
}

// More returns another page of the item's conversation. cursor is what the
// previous answer gave for that kind; id names the reply whose own replies a
// "thread" page loads.
func (s *Service) More(ctx context.Context, t Target, kind, cursor, id string) (*Page, error) {
	if !s.Supported(t) {
		return nil, ErrUnsupported
	}
	p := PlatformOf(t)
	switch {
	case kind == KindReplies && (p == Bluesky || p == Substack):
		return s.moreReplies(ctx, t, cursor)
	case kind == KindThread && p == Substack:
		return s.substackThread(ctx, t, id)
	case kind == KindThread && p == Bluesky && strings.HasPrefix(id, "at://"):
	case (kind == KindQuotes || kind == KindReposts) && p == Bluesky:
	default:
		return nil, ErrBadPage
	}
	key := strings.Join([]string{p, t.ExternalID, kind, cursor, id}, "|")
	return s.cachedPage(ctx, key, func() (*Page, error) {
		switch kind {
		case KindThread:
			return s.bskyThread(ctx, id)
		case KindQuotes:
			return s.bskyQuotes(ctx, t.ExternalID, cursor)
		default:
			return s.bskyReposts(ctx, t.ExternalID, cursor)
		}
	})
}

// moreReplies slices the next page of top-level replies out of the cached full
// conversation. The cursor is an offset; a refetch between pages can reorder
// replies by a like or two, so the client drops ones it already has.
func (s *Service) moreReplies(ctx context.Context, t Target, cursor string) (*Page, error) {
	off, err := strconv.Atoi(cursor)
	if err != nil || off < 0 {
		return nil, ErrBadPage
	}
	full, err := s.full(ctx, t)
	if err != nil {
		return nil, err
	}
	page := &Page{Kind: KindReplies, Items: []Comment{}}
	if off >= len(full.Replies) {
		return page, nil
	}
	page.Items = trimTree(full.Replies[off:], RepliesPage, ChildrenShown)
	if next := off + RepliesPage; next < len(full.Replies) {
		page.Cursor = strconv.Itoa(next)
	}
	return page, nil
}

// substackThread is a comment's replies, from the cached tree.
func (s *Service) substackThread(ctx context.Context, t Target, id string) (*Page, error) {
	full, err := s.full(ctx, t)
	if err != nil {
		return nil, err
	}
	c := findComment(full.Replies, id)
	if c == nil {
		return nil, ErrBadPage
	}
	return &Page{Kind: KindThread, Items: trimTree(c.Children, ThreadChildren, ChildrenShown)}, nil
}

func findComment(cs []Comment, id string) *Comment {
	for i := range cs {
		if cs[i].ID == id {
			return &cs[i]
		}
		if c := findComment(cs[i].Children, id); c != nil {
			return c
		}
	}
	return nil
}

// bskyThread fetches the replies under one reply, three levels deep.
func (s *Service) bskyThread(ctx context.Context, uri string) (*Page, error) {
	var thread struct {
		Thread bskyThreadNode `json:"thread"`
	}
	q := url.Values{"uri": {uri}, "depth": {strconv.Itoa(threadDepth)}, "parentHeight": {"0"}}
	if err := s.getJSON(ctx, s.cfg.BskyBase+"/app.bsky.feed.getPostThread?"+q.Encode(), &thread); err != nil {
		return nil, err
	}
	if thread.Thread.Post == nil {
		return &Page{Kind: KindThread, Items: []Comment{}}, nil // deleted since
	}
	kids := bskyReplies(thread.Thread.Replies, threadDepth)
	return &Page{Kind: KindThread, Items: nonNil(trimTree(kids, ThreadChildren, ChildrenShown))}, nil
}

func (s *Service) bskyQuotes(ctx context.Context, uri, cursor string) (*Page, error) {
	var resp struct {
		Posts  []bskyPostView `json:"posts"`
		Cursor string         `json:"cursor"`
	}
	q := url.Values{"uri": {uri}, "limit": {strconv.Itoa(QuotesPage)}}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	if err := s.getJSON(ctx, s.cfg.BskyBase+"/app.bsky.feed.getQuotes?"+q.Encode(), &resp); err != nil {
		return nil, err
	}
	page := &Page{Kind: KindQuotes, Items: []Comment{}}
	for _, p := range resp.Posts {
		page.Items = append(page.Items, bskyComment(p))
	}
	mostLiked(page.Items)
	if len(resp.Posts) >= QuotesPage {
		page.Cursor = resp.Cursor
	}
	return page, nil
}

func (s *Service) bskyReposts(ctx context.Context, uri, cursor string) (*Page, error) {
	var resp struct {
		RepostedBy []struct {
			DID         string `json:"did"`
			Handle      string `json:"handle"`
			DisplayName string `json:"displayName"`
			Avatar      string `json:"avatar"`
		} `json:"repostedBy"`
		Cursor string `json:"cursor"`
	}
	q := url.Values{"uri": {uri}, "limit": {strconv.Itoa(RepostsPage)}}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	if err := s.getJSON(ctx, s.cfg.BskyBase+"/app.bsky.feed.getRepostedBy?"+q.Encode(), &resp); err != nil {
		return nil, err
	}
	page := &Page{Kind: KindReposts, Items: []Comment{}, People: []Person{}}
	for _, r := range resp.RepostedBy {
		who := firstNonEmpty(r.Handle, r.DID)
		page.People = append(page.People, Person{
			Name:      firstNonEmpty(r.DisplayName, r.Handle),
			Handle:    r.Handle,
			AvatarURL: r.Avatar,
			URL:       "https://bsky.app/profile/" + url.PathEscape(who),
		})
	}
	if len(resp.RepostedBy) >= RepostsPage {
		page.Cursor = resp.Cursor
	}
	return page, nil
}

type pageEntry struct {
	page    *Page
	err     error
	expires time.Time
}

// cachedPage caches one upstream page like Get caches a conversation.
func (s *Service) cachedPage(ctx context.Context, key string, fetch func() (*Page, error)) (*Page, error) {
	now := s.now()
	s.mu.Lock()
	if e, ok := s.pages[key]; ok && now.Before(e.expires) {
		s.mu.Unlock()
		return e.page, e.err
	}
	s.mu.Unlock()
	page, err := fetch()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	ttl := s.cfg.TTL
	if err != nil {
		ttl = time.Minute
	}
	s.mu.Lock()
	if len(s.pages) > 2000 {
		for k, e := range s.pages {
			if !now.Before(e.expires) {
				delete(s.pages, k)
			}
		}
	}
	s.pages[key] = pageEntry{page: page, err: err, expires: now.Add(ttl)}
	s.mu.Unlock()
	return page, err
}

func nonNil(cs []Comment) []Comment {
	if cs == nil {
		return []Comment{}
	}
	return cs
}
