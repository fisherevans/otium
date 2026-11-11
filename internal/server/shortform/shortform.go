// Package shortform decides whether a Substack or Medium item is a short post or
// an article (#209), and turns a short one into the same structured post a
// Bluesky item carries (richtext.Post), so the client draws it as a post.
//
// Substack is now used both ways: some publications write essays, and some write
// a few sentences and a picture, the way people post on Bluesky. The feed does not
// say which, so the body decides: it is a post when its own text is short and it
// carries at most one picture and nothing otium cannot draw inline (an embedded
// video, audio, a tweet, an embedded post, a table). Everything else stays an
// article - a wrong "post" loses content on the card, a wrong "article" only looks
// heavier than it needs to.
//
// Word counts ignore the platform's furniture: Substack's subscribe and share
// buttons, image captions' expand icons, footnote anchors, Medium's tracking pixel
// and its "originally published on Medium" footer. Pure; no I/O.
//
//	post, stats := shortform.Classify(title, author, contentHTML)
//	if post != nil { item.PostJSON = richtext.Marshal(post) }
package shortform

import (
	"strings"
	"unicode"

	"github.com/fisherevans/otium/internal/server/richtext"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// MaxWords is the most body text a short post may have. Sampled on 2026-11-03
// (changelog 2026-11-03-social-cards.md): 514 entries from 24 Substack and 6
// Medium feeds, lengths from Substack's archive where it had them. The posts that
// read as posts - a chart and two sentences, an open thread, a meetup notice, a
// photo with a caption, a short poem - all came in under ~200 words; the shortest
// essays start around 300, and the 200-300 band is thin (19 entries) and mixed.
// 250 words is also about one phone screen of text at reading size, so a post
// below it shows whole on the card instead of being trimmed like an article.
const MaxWords = 250

// Kinds are the source kinds this applies to.
var Kinds = map[string]bool{"substack": true, "medium": true}

// Known is what the platform reports about a post beyond its feed entry:
// Substack's archive gives the real word count (a paid post's feed entry is a
// preview) and the post type. Nil when unknown, as for Medium.
type Known struct {
	Words int
	Type  string // newsletter | thread | podcast | video
}

// Input is one feed entry.
type Input struct {
	Title, Author, Body string
	Known               *Known
}

// Stats is what the classifier measured.
type Stats struct {
	Words  int // body text in the feed entry
	Images int
	// Rich counts what a post cannot show: embedded video or audio, iframes,
	// tweets, embedded posts, tables, code blocks.
	Rich int
	// Truncated marks a feed entry that is a preview: Substack's trailing "Read
	// more", Medium's "Continue reading" snippet.
	Truncated bool
	// Full is the post's real length: the platform's count when known, else the
	// feed's.
	Full int
	Type string
}

// Short reports whether stats describe a post: short, at most one picture,
// nothing a post cannot draw, and whole - a preview of a short post is still a
// preview, and a podcast or video post's media is not in its body.
func (s Stats) Short() bool {
	if s.Rich > 0 || s.Images > 1 || s.Full >= MaxWords || s.Type == "podcast" || s.Type == "video" {
		return false
	}
	if s.Truncated && s.Words < s.Full-15 {
		return false // the feed has only part of it
	}
	if s.Truncated && s.Full == s.Words && s.Type == "" {
		return false // a preview of unknown length
	}
	return s.Words > 0 || s.Images == 1
}

// Classify measures an entry and, when it is a short post, returns it as one.
// The author is the item's author (or publication); the title is kept as the
// post's title line.
func Classify(in Input) (*richtext.Post, Stats) {
	w := walk(in.Body)
	st := Stats{Words: words(w.text()), Images: len(w.images), Rich: w.rich, Truncated: w.truncated}
	st.Full = st.Words
	if in.Known != nil {
		st.Type = in.Known.Type
		if in.Known.Words > st.Full {
			st.Full = in.Known.Words
		}
		if st.Type == "" {
			st.Type = "newsletter"
		}
	}
	if !st.Short() {
		return nil, st
	}
	p := &richtext.Post{
		Author:   richtext.Author{Name: strings.TrimSpace(in.Author)},
		Title:    strings.TrimSpace(in.Title),
		Segments: w.segments(),
		Images:   w.images,
	}
	return p, st
}

type walker struct {
	segs   []richtext.Segment
	images []richtext.Image
	rich   int
	// truncated is set by a "Read more" / "Continue reading" preview marker.
	truncated bool
	// para is set when the next text starts a new paragraph.
	para bool
}

func walk(body string) *walker {
	w := &walker{}
	root, err := html.Parse(strings.NewReader("<body>" + body + "</body>"))
	if err != nil {
		return w
	}
	w.node(root, "")
	return w
}

// block elements start a new paragraph.
var block = map[atom.Atom]bool{
	atom.P: true, atom.Div: true, atom.Li: true, atom.H1: true, atom.H2: true, atom.H3: true,
	atom.H4: true, atom.H5: true, atom.H6: true, atom.Blockquote: true, atom.Figure: true,
	atom.Ul: true, atom.Ol: true, atom.Hr: true, atom.Section: true,
}

func (w *walker) node(n *html.Node, href string) {
	switch n.Type {
	case html.TextNode:
		w.addText(n.Data, href)
		return
	case html.ElementNode:
	default:
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			w.node(c, href)
		}
		return
	}
	if preview(n) {
		w.truncated = true
		return
	}
	if furniture(n) {
		return
	}
	switch n.DataAtom {
	case atom.Script, atom.Style, atom.Noscript, atom.Svg, atom.Button, atom.Form, atom.Figcaption, atom.Source:
		return
	case atom.Iframe, atom.Video, atom.Audio, atom.Table, atom.Pre, atom.Object, atom.Embed:
		w.rich++
		return
	case atom.Img:
		if im, ok := image(n); ok {
			w.images = append(w.images, im)
		}
		return
	case atom.Br:
		w.addText("\n", "")
		return
	case atom.A:
		if u := richtext.SafeURL(attr(n, "href")); u != "" && !hasClass(n, "image-link") {
			href = u
		}
	}
	if hasClass(n, "youtube-wrap", "tweet", "embedded-post-wrap", "embedded-post", "instagram", "spotify-wrap",
		"apple-podcast-container", "vimeo-wrap", "native-video-embed", "digest-post-embed", "poll-embed",
		"tiktok-wrap", "bluesky-wrap", "twitter-embed", "datawrapper-wrap", "latex-rendered") {
		w.rich++
		return
	}
	isBlock := block[n.DataAtom]
	if isBlock {
		w.para = true
	}
	if n.DataAtom == atom.Li {
		w.addText("• ", "")
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		w.node(c, href)
	}
	if isBlock {
		w.para = true
	}
}

// preview recognizes the marker that ends a truncated feed entry: Substack's
// "Read more" link on its own line, and Medium's feed snippet.
func preview(n *html.Node) bool {
	if hasClass(n, "medium-feed-link", "medium-feed-snippet") {
		return true
	}
	if n.DataAtom == atom.A {
		t := strings.ToLower(strings.TrimSpace(textOf(n)))
		return t == "read more" || strings.HasPrefix(t, "continue reading")
	}
	return false
}

// furniture is the platform's chrome inside a post body, not its content.
func furniture(n *html.Node) bool {
	if hasClass(n, "subscription-widget-wrap", "subscription-widget-wrap-editor", "subscription-widget",
		"button-wrapper", "image-link-expand", "footnote-anchor", "footnote", "footnote-hovercard-target",
		"captioned-button-wrap", "community-chat", "paywall-jump", "share-dialog",
		"tmblr-alt-text-helper") {
		return true
	}
	if n.DataAtom == atom.A && hasClass(n, "button") {
		return true
	}
	// Medium's footer: "<Title> was originally published in <Pub> on Medium".
	if n.DataAtom == atom.P {
		t := textOf(n)
		if strings.Contains(t, "was originally published") && strings.Contains(t, "on Medium") {
			return true
		}
	}
	return false
}

func (w *walker) addText(s, href string) {
	if s == "\n" {
		w.push("\n", "")
		return
	}
	s = collapse(s)
	if s == "" {
		return
	}
	if strings.TrimSpace(s) == "" {
		if w.para || len(w.segs) == 0 || endsSpace(w.text()) {
			return
		}
		w.push(" ", href)
		return
	}
	if w.para {
		w.para = false
		if strings.TrimSpace(w.text()) != "" {
			w.trimTrailing()
			w.push("\n\n", "")
		}
		s = strings.TrimLeft(s, " ")
	} else if len(w.segs) == 0 || endsSpace(w.text()) {
		s = strings.TrimLeft(s, " ")
	}
	w.push(s, href)
}

// collapse folds runs of HTML whitespace into one space.
func collapse(s string) string {
	var b strings.Builder
	space := false
	for _, r := range s {
		if unicode.IsSpace(r) {
			if !space {
				b.WriteByte(' ')
			}
			space = true
			continue
		}
		space = false
		b.WriteRune(r)
	}
	return b.String()
}

func endsSpace(s string) bool { return strings.HasSuffix(s, " ") || strings.HasSuffix(s, "\n") }

func (w *walker) push(s, href string) {
	kind := ""
	if href != "" {
		kind = "link"
	}
	if n := len(w.segs); n > 0 && w.segs[n-1].Href == href {
		w.segs[n-1].Text += s
		return
	}
	w.segs = append(w.segs, richtext.Segment{Text: s, Kind: kind, Href: href})
}

func (w *walker) trimTrailing() {
	for len(w.segs) > 0 {
		last := &w.segs[len(w.segs)-1]
		last.Text = strings.TrimRight(last.Text, " ")
		if last.Text != "" {
			return
		}
		w.segs = w.segs[:len(w.segs)-1]
	}
}

func (w *walker) text() string { return richtext.Plain(w.segs) }

// segments is the final text: trimmed, at most one blank line between
// paragraphs, a link that is only whitespace folded into the text.
func (w *walker) segments() []richtext.Segment {
	w.trimTrailing()
	out := []richtext.Segment{} // never null: clients map over it
	for _, s := range w.segs {
		if s.Href != "" && strings.TrimSpace(s.Text) == "" {
			s.Href, s.Kind = "", ""
		}
		if n := len(out); n > 0 && out[n-1].Href == "" && s.Href == "" {
			out[n-1].Text += s.Text
			continue
		}
		out = append(out, s)
	}
	for i := range out {
		for strings.Contains(out[i].Text, "\n\n\n") {
			out[i].Text = strings.ReplaceAll(out[i].Text, "\n\n\n", "\n\n")
		}
		out[i].Text = strings.ReplaceAll(out[i].Text, " \n", "\n")
		out[i].Text = strings.ReplaceAll(out[i].Text, "\n ", "\n")
	}
	if len(out) > 0 && out[0].Href == "" {
		out[0].Text = strings.TrimLeft(out[0].Text, " \n")
		if out[0].Text == "" {
			out = out[1:]
		}
	}
	return out
}

func image(n *html.Node) (richtext.Image, bool) {
	src := richtext.SafeURL(attr(n, "src"))
	if src == "" {
		return richtext.Image{}, false
	}
	// Tracking pixels and icons are not pictures.
	if attr(n, "width") == "1" || attr(n, "height") == "1" || strings.Contains(src, "/_/stat?") {
		return richtext.Image{}, false
	}
	if w := atoi(attr(n, "width")); w > 0 && w < 48 {
		return richtext.Image{}, false
	}
	im := richtext.Image{Thumb: src, Full: src, Alt: strings.TrimSpace(attr(n, "alt"))}
	if w, h := atoi(attr(n, "width")), atoi(attr(n, "height")); w > 0 && h > 0 {
		im.Aspect = float64(int(float64(w)/float64(h)*1000)) / 1000
	}
	return im, true
}

func words(s string) int {
	n := 0
	for _, f := range strings.Fields(s) {
		if strings.IndexFunc(f, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) >= 0 {
			n++
		}
	}
	return n
}

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

func hasClass(n *html.Node, names ...string) bool {
	cls := strings.Fields(attr(n, "class"))
	for _, c := range cls {
		for _, want := range names {
			if c == want {
				return true
			}
		}
	}
	return false
}

func textOf(n *html.Node) string {
	var b strings.Builder
	var f func(*html.Node)
	f = func(n *html.Node) {
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			f(c)
		}
	}
	f(n)
	return b.String()
}

func atoi(s string) int {
	n := 0
	for _, r := range strings.TrimSpace(s) {
		if r < '0' || r > '9' {
			return 0
		}
		n = n*10 + int(r-'0')
		if n > 1e6 {
			return 0
		}
	}
	return n
}
