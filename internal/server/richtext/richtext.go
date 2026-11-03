// Package richtext turns a social post's text and its rich-text annotations into
// something a client can render without re-deriving offsets (#207), and holds the
// structured post payload stored with a Bluesky item.
//
// Bluesky shortens long URLs in a post's visible text ("lnk.to/onthemedia/b...")
// and keeps the real target in the record's facets, alongside mentions and
// hashtags. Facets index the text by UTF-8 BYTE offsets, not characters, so the
// split happens here on the server, where the string is still bytes: the client
// gets an ordered list of segments, each plain text or a link, and concatenating
// their text gives back the post's text exactly.
//
// Everything is plain data. Hrefs are only ever http(s) URLs: a link facet with
// any other scheme renders as plain text. Nothing here does I/O; a Post is built
// by the platform adapters (social, conversation) and stored as JSON.
package richtext

import (
	"encoding/json"
	"html"
	"net/url"
	"sort"
	"strings"
	"unicode/utf8"
)

// Segment is one run of a post's text. Kind and Href are empty for plain text.
type Segment struct {
	Text string `json:"text"`
	Kind string `json:"kind,omitempty"` // link | mention | tag
	Href string `json:"href,omitempty"`
}

// Facet is app.bsky.richtext.facet as it appears in a post record.
type Facet struct {
	Index struct {
		ByteStart int `json:"byteStart"`
		ByteEnd   int `json:"byteEnd"`
	} `json:"index"`
	Features []struct {
		Type string `json:"$type"`
		URI  string `json:"uri"` // #link
		DID  string `json:"did"` // #mention
		Tag  string `json:"tag"` // #tag
	} `json:"features"`
}

// Segments splits text by its facets. Invalid facets are ignored, never fatal: a
// range outside the text, empty or reversed, overlapping an earlier facet, or
// cutting a multi-byte character in half; a feature with no usable target. What
// remains is plain text, so a post always renders.
func Segments(text string, facets []Facet) []Segment {
	type span struct {
		start, end int
		kind, href string
	}
	var spans []span
	for _, f := range facets {
		s, e := f.Index.ByteStart, f.Index.ByteEnd
		if s < 0 || e > len(text) || s >= e || !boundary(text, s) || !boundary(text, e) {
			continue
		}
		kind, href := "", ""
		for _, ft := range f.Features {
			switch {
			case strings.HasSuffix(ft.Type, "#link"):
				if u := SafeURL(ft.URI); u != "" {
					kind, href = "link", u
				}
			case strings.HasSuffix(ft.Type, "#mention"):
				if ft.DID != "" {
					kind, href = "mention", "https://bsky.app/profile/"+url.PathEscape(ft.DID)
				}
			case strings.HasSuffix(ft.Type, "#tag"):
				if t := strings.TrimPrefix(strings.TrimSpace(ft.Tag), "#"); t != "" {
					kind, href = "tag", "https://bsky.app/hashtag/"+url.PathEscape(t)
				}
			}
			if href != "" {
				break
			}
		}
		if href != "" {
			spans = append(spans, span{s, e, kind, href})
		}
	}
	sort.SliceStable(spans, func(i, j int) bool { return spans[i].start < spans[j].start })

	var out []Segment
	at := 0
	for _, sp := range spans {
		if sp.start < at {
			continue // overlaps the previous facet
		}
		if sp.start > at {
			out = append(out, Segment{Text: text[at:sp.start]})
		}
		out = append(out, Segment{Text: text[sp.start:sp.end], Kind: sp.kind, Href: sp.href})
		at = sp.end
	}
	if at < len(text) {
		out = append(out, Segment{Text: text[at:]})
	}
	return out
}

// boundary reports whether byte offset i starts a character (or is the end).
func boundary(s string, i int) bool {
	return i == len(s) || (i >= 0 && i < len(s) && utf8.RuneStart(s[i]))
}

// SafeURL returns u when it is an absolute http(s) URL, else "".
func SafeURL(u string) string {
	p, err := url.Parse(strings.TrimSpace(u))
	if err != nil || p.Host == "" || (p.Scheme != "http" && p.Scheme != "https") {
		return ""
	}
	return p.String()
}

// Plain is the segments' text, which is the post's text.
func Plain(segs []Segment) string {
	var b strings.Builder
	for _, s := range segs {
		b.WriteString(s.Text)
	}
	return b.String()
}

// HTML renders segments as escaped HTML with anchors and <br> line breaks, for
// the stored reader body and anything else that wants markup.
func HTML(segs []Segment) string {
	var b strings.Builder
	for _, s := range segs {
		t := strings.ReplaceAll(html.EscapeString(s.Text), "\n", "<br>")
		if s.Href == "" {
			b.WriteString(t)
			continue
		}
		b.WriteString(`<a href="` + html.EscapeString(s.Href) + `">` + t + `</a>`)
	}
	return b.String()
}

// ---- the stored post --------------------------------------------------------

// Post is a social post shaped for rendering: who wrote it, its text as
// segments, and what is attached. Stored as JSON in items.post_json and sent to
// the client as an item's post_body.
type Post struct {
	Author   Author    `json:"author"`
	Segments []Segment `json:"segments"`
	Images   []Image   `json:"images,omitempty"`
	Link     *Link     `json:"link,omitempty"`
	Video    *Video    `json:"video,omitempty"`
	Quote    *Quote    `json:"quote,omitempty"`
}

type Author struct {
	Name   string `json:"name"`
	Handle string `json:"handle,omitempty"`
	Avatar string `json:"avatar,omitempty"`
	URL    string `json:"url,omitempty"` // the author's profile
}

type Image struct {
	Thumb  string  `json:"thumb"`
	Full   string  `json:"full,omitempty"`
	Alt    string  `json:"alt,omitempty"`
	Aspect float64 `json:"aspect,omitempty"` // width / height; 0 = unknown
}

// Link is an external link card: the page a post links to.
type Link struct {
	URI         string `json:"uri"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	Thumb       string `json:"thumb,omitempty"`
	Domain      string `json:"domain,omitempty"`
}

type Video struct {
	Thumb  string  `json:"thumb,omitempty"`
	Aspect float64 `json:"aspect,omitempty"`
}

// Quote is a post this post quotes, shown inset.
type Quote struct {
	Author      Author    `json:"author"`
	Segments    []Segment `json:"segments"`
	URL         string    `json:"url,omitempty"`
	PublishedAt string    `json:"published_at,omitempty"`
	// Media names what the quoted post carries that its text does not show.
	Media string `json:"media,omitempty"` // image | video | link
	Thumb string `json:"thumb,omitempty"`
}

// Text is the post's text.
func (p *Post) Text() string { return Plain(p.Segments) }

// Picture is the post's own picture for a card: its first image, else its video
// poster, else its link card's thumbnail.
func (p *Post) Picture() string {
	switch {
	case len(p.Images) > 0:
		return p.Images[0].Thumb
	case p.Video != nil && p.Video.Thumb != "":
		return p.Video.Thumb
	case p.Link != nil:
		return p.Link.Thumb
	}
	return ""
}

// Marshal encodes a post for storage; nil is "".
func Marshal(p *Post) string {
	if p == nil {
		return ""
	}
	b, err := json.Marshal(p)
	if err != nil {
		return ""
	}
	return string(b)
}

// Unmarshal decodes a stored post; "" or anything unreadable is nil.
func Unmarshal(s string) *Post {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	var p Post
	if err := json.Unmarshal([]byte(s), &p); err != nil {
		return nil
	}
	return &p
}

// Domain is a URL's host without "www.", for a link card's caption.
func Domain(u string) string {
	p, err := url.Parse(u)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(p.Hostname()), "www.")
}
