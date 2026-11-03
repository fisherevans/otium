package richtext

import (
	"strings"
)

// Bluesky AppView shapes (app.bsky.feed.defs#postView and the embed views), the
// parts a rendered post needs. Shared by the ingester and the conversation
// fetcher so a post, a reply and a quote are built the same way.

type BskyAuthor struct {
	DID         string `json:"did"`
	Handle      string `json:"handle"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

type BskyRecord struct {
	Text      string  `json:"text"`
	CreatedAt string  `json:"createdAt"`
	Facets    []Facet `json:"facets"`
}

type bskyAspect struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

func (a *bskyAspect) ratio() float64 {
	if a == nil || a.Width <= 0 || a.Height <= 0 {
		return 0
	}
	return a.Width / a.Height
}

// BskyEmbedView is any of images#view, external#view, video#view, record#view
// and recordWithMedia#view; the $type says which fields are set.
type BskyEmbedView struct {
	Type   string `json:"$type"`
	Images []struct {
		Thumb       string      `json:"thumb"`
		Fullsize    string      `json:"fullsize"`
		Alt         string      `json:"alt"`
		AspectRatio *bskyAspect `json:"aspectRatio"`
	} `json:"images"`
	External *struct {
		URI         string `json:"uri"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Thumb       string `json:"thumb"`
	} `json:"external"`
	// video#view
	Thumbnail   string      `json:"thumbnail"`
	Playlist    string      `json:"playlist"`
	AspectRatio *bskyAspect `json:"aspectRatio"`
	// record#view: the quoted post (or a not-found/blocked stub). In
	// recordWithMedia#view this is a record#view, which wraps one more level.
	Record *BskyRecordView `json:"record"`
	// recordWithMedia#view: the media beside the quoted record.
	Media *BskyEmbedView `json:"media"`
}

// BskyRecordView is app.bsky.embed.record#viewRecord, or the record#view
// wrapper recordWithMedia nests it in.
type BskyRecordView struct {
	Type   string          `json:"$type"`
	URI    string          `json:"uri"`
	Author BskyAuthor      `json:"author"`
	Value  BskyRecord      `json:"value"`
	Record *BskyRecordView `json:"record"`
	Likes  int             `json:"likeCount"`
	Reply  int             `json:"replyCount"`
	Embeds []BskyEmbedView `json:"embeds"`
	// A shared feed (generatorView), list (listView) or starter pack
	// (starterpackViewBasic, whose name is in its record) instead of a post.
	DisplayName string      `json:"displayName"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Avatar      string      `json:"avatar"`
	Creator     *BskyAuthor `json:"creator"`
}

// BskyPostURL is a post's web address: https://bsky.app/profile/<handle>/post/<rkey>.
func BskyPostURL(handle, uri string) string {
	rkey := uri[strings.LastIndex(uri, "/")+1:]
	if handle == "" || rkey == "" {
		return ""
	}
	return "https://bsky.app/profile/" + handle + "/post/" + rkey
}

// BskyAuthorOf is the rendered author for a Bluesky profile view.
func BskyAuthorOf(a BskyAuthor) Author {
	id := a.Handle
	if id == "" {
		id = a.DID
	}
	out := Author{Name: strings.TrimSpace(a.DisplayName), Handle: a.Handle, Avatar: a.Avatar}
	if out.Name == "" {
		out.Name = a.Handle
	}
	if id != "" {
		out.URL = "https://bsky.app/profile/" + id
	}
	return out
}

// BskyPost builds a rendered post from a post view's author, record and embed.
func BskyPost(a BskyAuthor, r BskyRecord, e *BskyEmbedView) *Post {
	p := &Post{Author: BskyAuthorOf(a), Segments: Segments(strings.TrimRight(r.Text, " \n\t"), r.Facets)}
	if e == nil {
		return p
	}
	media := e
	if strings.HasPrefix(e.Type, "app.bsky.embed.recordWithMedia") {
		media = e.Media
	}
	if media != nil {
		attachMedia(p, media)
	}
	p.Quote = bskyQuote(e)
	return p
}

func attachMedia(p *Post, e *BskyEmbedView) {
	for _, im := range e.Images {
		if im.Thumb == "" && im.Fullsize == "" {
			continue
		}
		p.Images = append(p.Images, Image{
			Thumb: firstNonEmpty(im.Thumb, im.Fullsize), Full: firstNonEmpty(im.Fullsize, im.Thumb),
			Alt: im.Alt, Aspect: im.AspectRatio.ratio(),
		})
	}
	if x := e.External; x != nil {
		if u := SafeURL(x.URI); u != "" {
			p.Link = &Link{URI: u, Title: strings.TrimSpace(x.Title), Description: strings.TrimSpace(x.Description), Thumb: x.Thumb, Domain: Domain(u)}
		}
	}
	if strings.HasPrefix(e.Type, "app.bsky.embed.video") || e.Playlist != "" {
		p.Video = &Video{Thumb: e.Thumbnail, Aspect: e.AspectRatio.ratio(), Playlist: SafeURL(e.Playlist)}
	}
}

// bskyQuote extracts what an embed quotes, if anything: record#view, or the
// record half of recordWithMedia#view. A quoted post carries its own media the
// way Bluesky and X draw a quote: its pictures, its video poster, its link card,
// and a line naming the post it quotes in turn. A quoted post that cannot be
// shown (deleted, blocked, detached by its author) is still a Quote, so the
// reader sees that something was quoted rather than a post that seems to say
// nothing. A shared feed, list or starter pack is a Quote of that kind.
func bskyQuote(e *BskyEmbedView) *Quote {
	if e == nil || e.Record == nil {
		return nil
	}
	r := e.Record
	if strings.HasPrefix(e.Type, "app.bsky.embed.recordWithMedia") && r.Record != nil {
		r = r.Record
	}
	t := r.Type
	switch {
	case strings.HasSuffix(t, "#viewNotFound"):
		return &Quote{Kind: "unavailable", Segments: []Segment{}, Notice: "The quoted post was deleted"}
	case strings.HasSuffix(t, "#viewBlocked"):
		return &Quote{Kind: "unavailable", Segments: []Segment{}, Notice: "The quoted post is from a blocked account"}
	case strings.HasSuffix(t, "#viewDetached"):
		return &Quote{Kind: "unavailable", Segments: []Segment{}, Notice: "Removed by its author"}
	case strings.HasSuffix(t, "#generatorView"):
		return bskyShared(r, "feed", r.DisplayName)
	case strings.HasSuffix(t, "#listView"):
		return bskyShared(r, "list", r.Name)
	case strings.Contains(t, "starterpackView"):
		name := r.Name
		if r.Record != nil {
			name = firstNonEmpty(name, r.Record.Name)
		}
		return bskyShared(r, "starter pack", name)
	case !strings.HasSuffix(t, "#viewRecord"):
		return nil
	}
	q := &Quote{
		Author:      BskyAuthorOf(r.Author),
		Segments:    Segments(strings.TrimRight(r.Value.Text, " \n\t"), r.Value.Facets),
		URL:         BskyPostURL(r.Author.Handle, r.URI),
		PublishedAt: r.Value.CreatedAt,
	}
	if len(r.Embeds) > 0 {
		em := &r.Embeds[0]
		var m Post
		if strings.HasPrefix(em.Type, "app.bsky.embed.recordWithMedia") && em.Media != nil {
			attachMedia(&m, em.Media)
		} else {
			attachMedia(&m, em)
		}
		q.Images, q.Link, q.Video = m.Images, m.Link, m.Video
		switch {
		case len(m.Images) > 0:
			q.Media, q.Thumb = "image", m.Images[0].Thumb
		case m.Video != nil:
			q.Media, q.Thumb = "video", m.Video.Thumb
		case m.Link != nil:
			q.Media, q.Thumb = "link", m.Link.Thumb
		}
		// One level, like Bluesky: a quote inside a quote is named, not drawn.
		if inner := bskyQuote(em); inner != nil {
			if inner.Kind == "" {
				q.Quoting = inner.Author.Name
			} else if inner.Kind != "unavailable" {
				q.Quoting = inner.Title
			}
		}
	}
	return q
}

// bskyShared is a shared feed, list or starter pack, drawn as a small card.
func bskyShared(r *BskyRecordView, kind, title string) *Quote {
	q := &Quote{Kind: kind, Segments: []Segment{}, Title: strings.TrimSpace(title), Description: strings.TrimSpace(r.Description)}
	if r.Creator != nil {
		q.Author = BskyAuthorOf(*r.Creator)
		q.URL = bskySharedURL(r.Creator.Handle, kind, r.URI)
	}
	if r.Avatar != "" {
		q.Thumb = r.Avatar
	}
	return q
}

// bskySharedURL is the web address of a shared feed, list or starter pack.
func bskySharedURL(handle, kind, uri string) string {
	rkey := uri[strings.LastIndex(uri, "/")+1:]
	if handle == "" || rkey == "" {
		return ""
	}
	switch kind {
	case "feed":
		return "https://bsky.app/profile/" + handle + "/feed/" + rkey
	case "list":
		return "https://bsky.app/profile/" + handle + "/lists/" + rkey
	case "starter pack":
		return "https://bsky.app/starter-pack/" + handle + "/" + rkey
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
