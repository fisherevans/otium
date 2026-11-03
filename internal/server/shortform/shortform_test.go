package shortform

import (
	"os"
	"strings"
	"testing"

	"github.com/fisherevans/otium/internal/server/richtext"
)

// The testdata bodies are real feed entries sampled on 2026-11-03 (#209), with
// Substack's inline SVG icons, srcsets and <source> tags stripped to keep them
// small; text, images, embeds and preview markers are as published. Known is
// what each publication's /api/v1/archive reported for the post at the time.
func TestClassify(t *testing.T) {
	tests := []struct {
		name  string
		file  string
		known *Known
		short bool
		words int // feed body words, -1 = don't check
	}{
		// Short: posts.
		{"one chart and two sentences", "substack-krugman-short-chart", &Known{Words: 50, Type: "newsletter"}, true, 50},
		{"open thread", "substack-acx-open-thread", &Known{Words: 85, Type: "newsletter"}, true, 84},
		{"photo-only discussion thread", "substack-slowboring-photo-thread", &Known{Words: 0, Type: "newsletter"}, true, 0},
		{"medium short poem", "medium-ev-short-poem", nil, true, 112},
		// Articles.
		{"paid preview of a long post", "substack-slowboring-paid-preview", &Known{Words: 1693, Type: "newsletter"}, false, 28},
		{"paid preview, 340 words", "substack-marcus-paid-preview", &Known{Words: 340, Type: "newsletter"}, false, 22},
		{"podcast stub", "substack-hcr-podcast-stub", &Known{Words: 25, Type: "podcast"}, false, -1},
		{"long letter", "substack-hcr-long-letter", &Known{Words: 1720, Type: "newsletter"}, false, -1},
		{"long letter, archive unknown", "substack-hcr-long-letter", nil, false, -1},
		{"short text around a video", "substack-krugman-video-embed", &Known{Words: 42, Type: "newsletter"}, false, 42},
		{"two cartoons", "substack-reich-two-cartoons", &Known{Words: 216, Type: "newsletter"}, false, -1},
		{"music post with an embed", "substack-steady-music-embed", &Known{Words: 296, Type: "newsletter"}, false, -1},
		{"just over the line", "substack-vance-just-over", &Known{Words: 261, Type: "newsletter"}, false, -1},
		{"medium member teaser", "medium-atlantic-teaser", nil, false, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := os.ReadFile("testdata/" + tt.file + ".html")
			if err != nil {
				t.Fatal(err)
			}
			post, st := Classify(Input{Title: "T", Author: "A", Body: string(raw), Known: tt.known})
			if st.Short() != tt.short || (post != nil) != tt.short {
				t.Fatalf("short = %v (post %v), want %v; stats %+v", st.Short(), post != nil, tt.short, st)
			}
			if tt.words >= 0 && st.Words != tt.words {
				t.Errorf("words = %d, want %d", st.Words, tt.words)
			}
		})
	}
}

func TestClassifyPostShape(t *testing.T) {
	raw, err := os.ReadFile("testdata/substack-krugman-short-chart.html")
	if err != nil {
		t.Fatal(err)
	}
	post, _ := Classify(Input{Title: " Trumpflation and Travel ", Author: "Paul Krugman", Body: string(raw), Known: &Known{Words: 50}})
	if post == nil {
		t.Fatal("not a post")
	}
	if post.Title != "Trumpflation and Travel" || post.Author.Name != "Paul Krugman" {
		t.Errorf("title/author = %q / %q", post.Title, post.Author.Name)
	}
	if len(post.Images) != 1 || post.Images[0].Aspect < 1.44 || post.Images[0].Aspect > 1.45 || !strings.HasPrefix(post.Images[0].Thumb, "https://substackcdn.com/") {
		t.Errorf("images = %+v", post.Images)
	}
	text := richtext.Plain(post.Segments)
	if !strings.HasPrefix(text, "Travel day, so just one chart — the Federal") || strings.Contains(text, "\n") {
		t.Errorf("text = %q", text)
	}
}

func TestClassifyText(t *testing.T) {
	tests := []struct {
		name string
		body string
		want []richtext.Segment
	}{
		{"paragraphs", "<p>One  two.</p>\n<p>Three</p>", []richtext.Segment{{Text: "One two.\n\nThree"}}},
		{"line breaks", "<p>a<br>b</p>", []richtext.Segment{{Text: "a\nb"}}},
		{"links stay links", `<p>See <a href="https://x.test/a">the <em>chart</em></a>.</p>`,
			[]richtext.Segment{{Text: "See "}, {Text: "the chart", Kind: "link", Href: "https://x.test/a"}, {Text: "."}}},
		{"no javascript links", `<p><a href="javascript:alert(1)">x</a> y</p>`, []richtext.Segment{{Text: "x y"}}},
		{"list items", "<ul><li>one</li><li>two</li></ul>", []richtext.Segment{{Text: "• one\n\n• two"}}},
		{"furniture dropped", `<p>Hi.</p><p class="button-wrapper"><a class="button primary" href="https://x.test/subscribe"><span>Subscribe now</span></a></p><div class="subscription-widget-wrap"><p>Thanks for reading!</p></div>`,
			[]richtext.Segment{{Text: "Hi."}}},
		{"medium footer and pixel", `<p>Hi.</p><img src="https://medium.com/_/stat?event=post.clientViewed" width="1" height="1"><hr><p><a href="https://m">X</a> was originally published in <a href="https://p">P</a> on Medium.</p>`,
			[]richtext.Segment{{Text: "Hi."}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			post, st := Classify(Input{Body: tt.body})
			if post == nil {
				t.Fatalf("not a post: %+v", st)
			}
			if len(post.Images) != 0 {
				t.Errorf("images = %+v", post.Images)
			}
			if !equal(post.Segments, tt.want) {
				t.Errorf("segments = %#v\nwant %#v", post.Segments, tt.want)
			}
		})
	}
}

func TestStatsShort(t *testing.T) {
	tests := []struct {
		name string
		st   Stats
		want bool
	}{
		{"short text", Stats{Words: 120, Full: 120}, true},
		{"at the threshold", Stats{Words: MaxWords, Full: MaxWords}, false},
		{"photo only", Stats{Images: 1}, true},
		{"empty", Stats{}, false},
		{"two pictures", Stats{Words: 40, Full: 40, Images: 2}, false},
		{"embed", Stats{Words: 40, Full: 40, Rich: 1}, false},
		{"whole preview of a short paid post", Stats{Words: 27, Full: 27, Truncated: true, Type: "newsletter"}, true},
		{"partial preview", Stats{Words: 22, Full: 120, Truncated: true, Type: "newsletter"}, false},
		{"preview of unknown length", Stats{Words: 22, Full: 22, Truncated: true}, false},
		{"podcast", Stats{Words: 25, Full: 25, Type: "podcast"}, false},
		{"video", Stats{Words: 25, Full: 25, Type: "video"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.st.Short(); got != tt.want {
				t.Fatalf("Short() = %v, want %v", got, tt.want)
			}
		})
	}
}

func equal(a, b []richtext.Segment) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
