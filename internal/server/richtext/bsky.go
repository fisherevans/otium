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
		p.Video = &Video{Thumb: e.Thumbnail, Aspect: e.AspectRatio.ratio()}
	}
}

// bskyQuote extracts the post an embed quotes, if any: record#view, or the
// record half of recordWithMedia#view. Not-found, blocked, feed and list
// records are not posts and give nil.
func bskyQuote(e *BskyEmbedView) *Quote {
	if e == nil || e.Record == nil {
		return nil
	}
	r := e.Record
	if strings.HasPrefix(e.Type, "app.bsky.embed.recordWithMedia") && r.Record != nil {
		r = r.Record
	}
	if !strings.HasSuffix(r.Type, "#viewRecord") {
		return nil
	}
	q := &Quote{
		Author:      BskyAuthorOf(r.Author),
		Segments:    Segments(strings.TrimRight(r.Value.Text, " \n\t"), r.Value.Facets),
		URL:         BskyPostURL(r.Author.Handle, r.URI),
		PublishedAt: r.Value.CreatedAt,
	}
	if len(r.Embeds) > 0 {
		var m Post
		em := &r.Embeds[0]
		if strings.HasPrefix(em.Type, "app.bsky.embed.recordWithMedia") && em.Media != nil {
			em = em.Media
		}
		attachMedia(&m, em)
		switch {
		case len(m.Images) > 0:
			q.Media, q.Thumb = "image", m.Images[0].Thumb
		case m.Video != nil:
			q.Media, q.Thumb = "video", m.Video.Thumb
		case m.Link != nil:
			q.Media, q.Thumb = "link", m.Link.Thumb
		}
	}
	return q
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
