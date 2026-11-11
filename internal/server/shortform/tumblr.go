package shortform

import (
	"encoding/json"
	"net/url"
	"strings"

	"github.com/fisherevans/otium/internal/server/richtext"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// Tumblr turns a Tumblr feed entry (#216) into a post. A Tumblr blog's RSS
// carries each post's whole body as HTML in its own shapes:
//
//   - pictures in <figure class="tmblr-full"> (often inside <div class="npf_row">),
//     with their size in data-orig-width / data-orig-height
//   - a Tumblr-hosted video as a figure whose data-npf JSON names the MP4 and its
//     poster, wrapping a <video>
//   - a reblog as <p><a class="tumblr_blog" href="<original post>">name</a>:</p>
//     followed by a <blockquote> holding the original, then the reblogger's own
//     words, if any
//
// A reblog becomes the post's quoted post, so the card shows who said it first.
// Unlike Substack, a photoset is still a post: Tumblr posts are pictures far
// more often than prose. It stays an article when its text is long or it embeds
// something a post cannot draw (a YouTube iframe, an audio player).
func Tumblr(in Input) (*richtext.Post, Stats) {
	root, err := html.Parse(strings.NewReader("<body>" + in.Body + "</body>"))
	if err != nil {
		return nil, Stats{}
	}

	var quote *richtext.Quote
	qwords := 0
	if a, bq := reblog(root); bq != nil {
		qv := takeVideo(bq)
		ql := takeLink(bq)
		qw := &walker{}
		qw.node(bq, "")
		fixAspects(bq, qw.images)
		quote = &richtext.Quote{
			Author:   richtext.Author{Name: strings.TrimSpace(textOf(a)), Handle: tumblrBlog(attr(a, "href"))},
			URL:      richtext.SafeURL(attr(a, "href")),
			Segments: qw.segments(),
			Images:   qw.images,
			Video:    qv,
			Link:     ql,
		}
		if quote.Author.Handle != "" {
			quote.Author.URL = "https://" + quote.Author.Handle + ".tumblr.com/"
		} else if u, err := url.Parse(quote.URL); err == nil && u.Host != "" {
			// A blog on its own domain: the link text is its name.
			quote.Author.Handle = quote.Author.Name
			quote.Author.URL = "https://" + u.Host + "/"
		}
		qwords = words(qw.text())
		qrich := qw.rich
		a.Parent.Parent.RemoveChild(a.Parent)
		bq.Parent.RemoveChild(bq)
		if qrich > 0 {
			return nil, Stats{Rich: qrich}
		}
	}

	video := takeVideo(root)
	link := takeLink(root)
	w := &walker{}
	w.node(root, "")
	fixAspects(root, w.images)
	st := Stats{Words: words(w.text()) + qwords, Images: len(w.images), Rich: w.rich}
	st.Full = st.Words
	if st.Rich > 0 || st.Full >= MaxWords {
		return nil, st
	}
	p := &richtext.Post{
		Author:   richtext.Author{Name: strings.TrimSpace(in.Author)},
		Segments: w.segments(),
		Images:   w.images,
		Video:    video,
		Link:     link,
		Quote:    quote,
	}
	if len(p.Segments) == 0 && len(p.Images) == 0 && p.Video == nil && p.Link == nil && p.Quote == nil {
		return nil, st
	}
	return p, st
}

// reblog finds a reblog's attribution link and the blockquote it introduces:
// the first <p> holding an a.tumblr_blog, when the next element is a blockquote.
func reblog(root *html.Node) (*html.Node, *html.Node) {
	var found, bq *html.Node
	var f func(*html.Node)
	f = func(n *html.Node) {
		if found != nil {
			return
		}
		if n.Type == html.ElementNode && n.DataAtom == atom.A && hasClass(n, "tumblr_blog") &&
			n.Parent != nil && n.Parent.DataAtom == atom.P {
			next := n.Parent.NextSibling
			for next != nil && next.Type != html.ElementNode {
				next = next.NextSibling
			}
			if next != nil && next.DataAtom == atom.Blockquote {
				found, bq = n, next
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			f(c)
		}
	}
	f(root)
	return found, bq
}

// npfVideo is the part of a figure's data-npf JSON a video needs.
type npfVideo struct {
	Type     string `json:"type"`
	Provider string `json:"provider"`
	URL      string `json:"url"`
	Media    struct {
		URL    string `json:"url"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
	} `json:"media"`
	Poster []struct {
		URL string `json:"url"`
	} `json:"poster"`
}

// takeVideo removes every Tumblr-hosted video figure under n and returns the
// first as the post's video. Other providers' videos are left in place, so the
// walker counts them as something a post cannot draw.
func takeVideo(n *html.Node) *richtext.Video {
	var first *richtext.Video
	var drop []*html.Node
	var f func(*html.Node)
	f = func(n *html.Node) {
		if n.Type == html.ElementNode && n.DataAtom == atom.Figure {
			if raw := attr(n, "data-npf"); raw != "" {
				var v npfVideo
				if json.Unmarshal([]byte(raw), &v) == nil && v.Type == "video" && v.Provider == "tumblr" {
					file := richtext.SafeURL(firstNonEmpty(v.Media.URL, v.URL))
					if file != "" {
						if first == nil {
							first = &richtext.Video{File: file}
							if len(v.Poster) > 0 {
								first.Thumb = richtext.SafeURL(v.Poster[0].URL)
							}
							if v.Media.Width > 0 && v.Media.Height > 0 {
								first.Aspect = ratio(v.Media.Width, v.Media.Height)
							}
						}
						drop = append(drop, n)
						return
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			f(c)
		}
	}
	f(n)
	for _, d := range drop {
		d.Parent.RemoveChild(d)
	}
	return first
}

// takeLink removes Tumblr's link blocks (<p class="npf_link" data-npf=...>)
// under n and returns the first as the post's link card.
func takeLink(n *html.Node) *richtext.Link {
	var first *richtext.Link
	var drop []*html.Node
	var f func(*html.Node)
	f = func(n *html.Node) {
		if n.Type == html.ElementNode && hasClass(n, "npf_link") {
			var v struct {
				Type, URL, Title, Description string
				SiteName                      string `json:"site_name"`
			}
			if json.Unmarshal([]byte(attr(n, "data-npf")), &v) == nil && v.Type == "link" {
				if u := richtext.SafeURL(v.URL); u != "" {
					if first == nil {
						first = &richtext.Link{URI: u, Title: strings.TrimSpace(v.Title),
							Description: strings.TrimSpace(v.Description), Domain: v.SiteName}
					}
					drop = append(drop, n)
					return
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			f(c)
		}
	}
	f(n)
	for _, d := range drop {
		d.Parent.RemoveChild(d)
	}
	return first
}

// fixAspects fills each picture's aspect from Tumblr's data-orig-* size (on the
// img, or its figure), which it uses instead of width / height.
func fixAspects(root *html.Node, ims []richtext.Image) {
	sizes := map[string]float64{}
	var f func(*html.Node)
	f = func(n *html.Node) {
		if n.Type == html.ElementNode && n.DataAtom == atom.Img {
			for m := n; m != nil && m.DataAtom != atom.Body; m = m.Parent {
				if w, h := atoi(attr(m, "data-orig-width")), atoi(attr(m, "data-orig-height")); w > 0 && h > 0 {
					sizes[richtext.SafeURL(attr(n, "src"))] = ratio(w, h)
					break
				}
				if m.DataAtom == atom.Figure {
					break
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			f(c)
		}
	}
	f(root)
	for i := range ims {
		if ims[i].Aspect == 0 {
			ims[i].Aspect = sizes[ims[i].Full]
		}
	}
}

// tumblrBlog is the blog name in a Tumblr post or blog URL:
// name.tumblr.com/... or www.tumblr.com/name/... -> "name".
func tumblrBlog(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	host := strings.ToLower(strings.TrimPrefix(u.Host, "www."))
	if host == "tumblr.com" {
		return strings.Split(strings.Trim(u.Path, "/"), "/")[0]
	}
	if name, ok := strings.CutSuffix(host, ".tumblr.com"); ok {
		return name
	}
	return ""
}

func ratio(w, h int) float64 { return float64(int(float64(w)/float64(h)*1000)) / 1000 }

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
