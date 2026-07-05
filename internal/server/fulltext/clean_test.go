package fulltext

import (
	"strings"
	"testing"
)

// prose is a block of real article text, repeated to clear the length/density
// floors so tests exercise the media/markup gates rather than the 250-char min.
const prose = "The valley road climbs past the old mill and the water is high this spring. " +
	"Residents have watched the river rise for a week, and the town office is tracking the gauge hourly. " +
	"What follows is a plain account of how the flood came, who moved first, and what the damage looks like now. "

func repeat(s string, n int) string { return strings.Repeat(s, n) }

func TestCleanArticleHTML_StripsChrome(t *testing.T) {
	// Mirrors the VTDigger 347 failure: a leading skip-link + nav + trailing
	// footer surrounding the real article body.
	frag := `<div>
		<a href="#main" class="skip-link">Skip to content</a>
		<nav class="site-nav"><ul><li>News</li><li>Sections</li></ul></nav>
		<header class="masthead">VTDigger</header>
		<article><h1>Flood Watch</h1><p>` + repeat(prose, 3) + `</p></article>
		<div class="share-tools"><a>Share</a><a>Tweet</a></div>
		<footer class="site-footer">Copyright 2026</footer>
	</div>`

	cleaned, plain := cleanArticleHTML(frag)

	for _, banned := range []string{"Skip to content", "Sections", "VTDigger", "Share", "Copyright"} {
		if strings.Contains(cleaned, banned) {
			t.Errorf("cleaned HTML still contains chrome %q:\n%s", banned, cleaned)
		}
	}
	if !strings.Contains(cleaned, "Flood Watch") {
		t.Errorf("cleaned HTML lost the headline:\n%s", cleaned)
	}
	if !strings.Contains(plain, "valley road") {
		t.Errorf("plain text lost the body: %q", plain)
	}
	// Leading whitespace/skip-link must be gone: body should start at the headline.
	if strings.HasPrefix(strings.TrimSpace(cleaned), "<a") {
		t.Errorf("cleaned HTML still leads with a skip-link:\n%s", cleaned)
	}
}

func TestCleanArticleHTML_KeepsInlineImages(t *testing.T) {
	// A normal article with a lead image and inline figure must survive cleanup.
	frag := `<article><h1>Story</h1>
		<figure><img src="/lead.jpg"><figcaption>The mill</figcaption></figure>
		<p>` + repeat(prose, 4) + `</p>
		<img src="/inline.jpg">
		<p>` + repeat(prose, 4) + `</p></article>`
	cleaned, _ := cleanArticleHTML(frag)
	if !strings.Contains(cleaned, "lead.jpg") || !strings.Contains(cleaned, "inline.jpg") {
		t.Errorf("cleanup dropped legitimate inline images:\n%s", cleaned)
	}
}

func TestIsArticleLike(t *testing.T) {
	tests := []struct {
		name string
		html string
		want bool
	}{
		{
			name: "plain article",
			html: `<article><p>` + repeat(prose, 5) + `</p></article>`,
			want: true,
		},
		{
			name: "article with a few inline images",
			html: `<article><p>` + repeat(prose, 5) + `</p>` +
				`<img src=a.jpg><img src=b.jpg><p>` + repeat(prose, 3) + `</p></article>`,
			want: true,
		},
		{
			name: "photo gallery - many images, little text",
			html: `<div><p>Gallery</p>` +
				strings.Repeat(`<figure><img src=x.jpg><figcaption>Photo</figcaption></figure>`, 20) +
				`</div>`,
			want: false,
		},
		{
			name: "video embed page - thin prose around an iframe",
			html: `<div><h1>Watch this</h1><iframe src="https://youtube.com/embed/x"></iframe>` +
				`<p>A short blurb about the clip.</p></div>`,
			want: false,
		},
		{
			name: "embed with real long article still passes",
			html: `<article><p>` + repeat(prose, 8) + `</p>` +
				`<iframe src="https://example.com/chart"></iframe>` +
				`<p>` + repeat(prose, 4) + `</p></article>`,
			want: true,
		},
		{
			name: "too short",
			html: `<article><p>Just a sentence here.</p></article>`,
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleaned, plain := cleanArticleHTML(tt.html)
			if got := isArticleLike(cleaned, plain); got != tt.want {
				t.Errorf("isArticleLike = %v, want %v\ntextLen=%d htmlLen=%d\ncleaned=%s",
					got, tt.want, len(strings.TrimSpace(plain)), len(cleaned), cleaned)
			}
		})
	}
}
