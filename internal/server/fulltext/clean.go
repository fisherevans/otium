package fulltext

import (
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

// This file post-processes readability output (#99). go-readability distills the
// main content but leaves two problems for a text reader:
//
//  1. Chrome cruft. Nav bars, "Skip to content" links, share/subscribe widgets,
//     and footer boilerplate survive extraction (VTDigger item 347 opened with a
//     leading "Skip to content" + nav whitespace). cleanArticleHTML strips these
//     with goquery so the reader body starts at the headline.
//
//  2. Non-article pages that still extract. A gallery, a video/embed page, or a
//     custom-UI/interactive page can clear readability's bar and the 250-char
//     floor while being unreadable as plain text. isArticleLike gates on media
//     density and prose density so those resolve to 'external' (open original)
//     instead of rendering a broken text version.
//
// Both operate on the extracted fragment, never the raw page, and are pure
// string->string / string->bool so they're cheap and testable in isolation.

const (
	// minCharsPerMedia is the floor on prose characters per media element (img /
	// figure / iframe / video / ...). A normal article carries a few inline images
	// across thousands of chars and clears this easily; a gallery or media wall -
	// many media nodes, little text - fails. Conservative on purpose.
	minCharsPerMedia = 150
	// embedTextFloor is the prose floor (chars) a page needs when it contains a
	// rich embed (iframe / video / audio / embed / object). Articles rarely need
	// one; a page built around a player or interactive widget has little prose and
	// fails here even if it squeaks past the generic media ratio.
	embedTextFloor = 600
	// minProseRatio is the floor on visible-text-to-markup ratio. Markup-dominated
	// output (a wall of divs/spans/svg with little text) signals a custom-UI /
	// interactive page, not prose. A clean article body runs well above this after
	// cleanup, so the floor is set low to avoid false negatives.
	minProseRatio = 0.10
)

// structuralCruft is removed unconditionally: these tags/roles are never the
// article body itself. Readability usually drops them, but not always (leftover
// <nav>/<header> is exactly the VTDigger 347 failure).
var structuralCruft = []string{
	"script", "style", "noscript", "form", "nav", "aside",
	"[role=navigation]", "[role=banner]", "[role=complementary]",
	"[role=search]", "[aria-hidden=true]",
}

// cruftClassID matches class/id tokens for chrome that readability sometimes
// keeps inside the content node (share bars, related-post rails, newsletter
// prompts). Pattern-based removal is guarded by a text-length check
// (cruftTextGuard) so it can never delete a real content block that happens to
// carry one of these words in a class name.
var cruftClassID = regexp.MustCompile(`(?i)(^|[-_ ])(nav|navbar|menu|breadcrumb|masthead|footer|header|sidebar|skip|sr-only|screen-reader|visually-hidden|social|share|sharing|subscribe|newsletter|promo|related|recirc|widget|toolbar|byline-social|site-header|site-footer|global-)([-_ ]|$)`)

// skipLinkText matches the anchor text of accessibility "skip" links, which
// readability frequently leaves at the very top of the body.
var skipLinkText = regexp.MustCompile(`(?i)^\s*skip\s+to\s+(main|content|the\s+content|navigation)`)

// cruftTextGuard is the max text length (chars) a pattern-matched node may hold
// and still be treated as chrome. Above this it's presumed to be real content
// and left alone, even if its class matches a cruft pattern.
const cruftTextGuard = 400

// keepEmpty is the set of tags that carry meaning even with no text of their own,
// so the empty-node collapse must never remove them for being "empty".
var keepEmpty = map[string]bool{
	"img": true, "picture": true, "source": true, "iframe": true, "video": true,
	"audio": true, "embed": true, "object": true, "svg": true, "canvas": true,
	"br": true, "hr": true, "track": true,
}

// wsCollapse squashes any run of whitespace (incl. newlines) to a single space,
// used when measuring prose length and normalizing text nodes.
var wsCollapse = regexp.MustCompile(`\s+`)

// vwsCollapse matches a whitespace run that includes at least one newline, used to
// collapse blank-line/indentation pileups in the output HTML without disturbing
// single spaces between inline elements (those contain no newline).
var vwsCollapse = regexp.MustCompile(`[ \t]*\n[ \t\n]*`)

// cleanArticleHTML strips chrome from a readability-extracted fragment and
// returns the cleaned inner HTML plus its collapsed plain text (for the gate).
// On any parse failure it falls back to the input HTML and its naive text so a
// cleanup bug can never turn a real article into "external".
func cleanArticleHTML(fragment string) (cleanedHTML, plainText string) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(fragment))
	if err != nil {
		return fragment, collapseWS(stripTags(fragment))
	}
	body := doc.Find("body")

	// 1. Structural cruft: gone unconditionally.
	for _, sel := range structuralCruft {
		body.Find(sel).Remove()
	}
	// header/footer as tags: real article bodies occasionally wrap the headline in
	// <header>, so guard on text length before removing.
	body.Find("header, footer").Each(func(_ int, s *goquery.Selection) {
		if len(strings.TrimSpace(s.Text())) <= cruftTextGuard {
			s.Remove()
		}
	})

	// 2. Skip / accessibility links, wherever they sit.
	body.Find("a").Each(func(_ int, s *goquery.Selection) {
		if skipLinkText.MatchString(s.Text()) {
			s.Remove()
		}
	})

	// 3. Class/id cruft patterns, guarded so a large content node survives.
	body.Find("[class], [id]").Each(func(_ int, s *goquery.Selection) {
		class, _ := s.Attr("class")
		id, _ := s.Attr("id")
		if !cruftClassID.MatchString(class) && !cruftClassID.MatchString(id) {
			return
		}
		if len(strings.TrimSpace(s.Text())) > cruftTextGuard {
			return // real content, keep it
		}
		s.Remove()
	})

	// 4. Collapse empties: drop elements with no text and no media. Iterate a few
	// times so a container emptied by its now-removed children also goes.
	for i := 0; i < 3; i++ {
		removed := false
		body.Find("*").Each(func(_ int, s *goquery.Selection) {
			if keepEmpty[goquery.NodeName(s)] {
				return // the node itself carries meaning without text (img, iframe, ...)
			}
			if strings.TrimSpace(s.Text()) != "" {
				return
			}
			if s.Find("img,picture,figure,iframe,video,audio,embed,object,svg,br,hr").Length() > 0 {
				return // wraps a media child
			}
			s.Remove()
			removed = true
		})
		if !removed {
			break
		}
	}

	html, err := body.Html()
	if err != nil {
		return fragment, collapseWS(stripTags(fragment))
	}
	// Collapse runaway vertical whitespace between tags (readability leaves blank
	// lines and indentation where it removed nodes). Only runs containing a newline
	// are collapsed, so meaningful single spaces between inline elements survive.
	html = strings.TrimSpace(vwsCollapse.ReplaceAllString(html, "\n"))
	return html, collapseWS(body.Text())
}

// isArticleLike is the hypermedia gate (#99): true when the cleaned fragment
// reads as a genuine text article, false when it's media-dominated, embed-built,
// or markup-heavy and should resolve to 'external' instead of an in-app render.
func isArticleLike(cleanedHTML, plainText string) bool {
	textLen := len(strings.TrimSpace(plainText))
	if textLen < minTextLength {
		return false
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(cleanedHTML))
	if err != nil {
		// Can't inspect structure; fall back to the length check already passed.
		return true
	}
	body := doc.Find("body")
	imgs := body.Find("img, picture, figure").Length()
	embeds := body.Find("iframe, video, audio, embed, object").Length()
	media := imgs + embeds

	// A rich embed with thin prose is a player/interactive page, not an article.
	if embeds > 0 && textLen < embedTextFloor {
		return false
	}
	// Media-to-text density: enough prose per media element.
	if media > 0 && textLen/media < minCharsPerMedia {
		return false
	}
	// Prose-to-markup density: markup-dominated output is a custom UI, not prose.
	if h := len(cleanedHTML); h > 0 && float64(textLen)/float64(h) < minProseRatio {
		return false
	}
	return true
}

// collapseWS trims and squashes internal whitespace runs to single spaces.
func collapseWS(s string) string {
	return strings.TrimSpace(wsCollapse.ReplaceAllString(s, " "))
}

// stripTags is a last-resort plain-text extractor for the fallback path when
// goquery can't parse the fragment. Not a real sanitizer - only used to get an
// approximate length when structured parsing already failed.
var tagRE = regexp.MustCompile(`<[^>]*>`)

func stripTags(s string) string {
	return tagRE.ReplaceAllString(s, " ")
}
