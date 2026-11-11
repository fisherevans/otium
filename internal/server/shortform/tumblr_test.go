package shortform

import (
	"os"
	"strings"
	"testing"

	"github.com/fisherevans/otium/internal/server/richtext"
)

// The tumblr-* testdata bodies are real entries from scootyin2d.tumblr.com/rss,
// sampled on 2026-11-11 (#216), unedited.
func TestTumblr(t *testing.T) {
	tests := []struct {
		name       string
		file       string
		text       string // the post's own text starts with this
		images     int
		video      bool
		quoteBy    string // reblogged from; "" = not a reblog
		quoteText  string
		quoteImage bool
		quoteVideo bool
	}{
		{"gif and a line", "tumblr-gif-text", "just checking in.", 1, false, "", "", false, false},
		{"photo and a caption", "tumblr-photo-text", "", 1, false, "", "", false, false},
		{"own video", "tumblr-video", "added a background mode", 0, true, "", "", false, false},
		{"reblogged video", "tumblr-reblog-video", "", 0, false, "frozjen", "testing the inter-dimensional", false, true},
		{"reblogged gif", "tumblr-reblog-image", "", 0, false, "paradnightstudio", "Hours of refactoring", true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := os.ReadFile("testdata/" + tt.file + ".html")
			if err != nil {
				t.Fatal(err)
			}
			post, st := Tumblr(Input{Title: "T", Author: "scotty rich", Body: string(raw)})
			if post == nil {
				t.Fatalf("not a post; stats %+v", st)
			}
			if post.Title != "" {
				t.Errorf("title = %q, want none (the text is the headline)", post.Title)
			}
			if !strings.HasPrefix(post.Text(), tt.text) {
				t.Errorf("text = %q, want prefix %q", post.Text(), tt.text)
			}
			if len(post.Images) != tt.images {
				t.Errorf("images = %d, want %d", len(post.Images), tt.images)
			}
			for _, im := range post.Images {
				if im.Aspect == 0 {
					t.Errorf("image %s has no aspect", im.Full)
				}
			}
			if (post.Video != nil) != tt.video {
				t.Errorf("video = %+v, want %v", post.Video, tt.video)
			}
			if post.Video != nil && (post.Video.File == "" || post.Video.Thumb == "" || post.Video.Aspect == 0) {
				t.Errorf("video incomplete: %+v", post.Video)
			}
			if tt.quoteBy == "" {
				if post.Quote != nil {
					t.Fatalf("unexpected quote %+v", post.Quote)
				}
				return
			}
			q := post.Quote
			if q == nil {
				t.Fatal("reblog has no quote")
			}
			if q.Author.Handle != tt.quoteBy || q.URL == "" {
				t.Errorf("quote by %q at %q, want %q", q.Author.Handle, q.URL, tt.quoteBy)
			}
			if !strings.HasPrefix(strings.TrimSpace(richtext.Plain(q.Segments)), tt.quoteText) {
				t.Errorf("quote text = %q, want prefix %q", richtext.Plain(q.Segments), tt.quoteText)
			}
			if (len(q.Images) > 0) != tt.quoteImage || (q.Video != nil) != tt.quoteVideo {
				t.Errorf("quote images %d video %v", len(q.Images), q.Video != nil)
			}
		})
	}
}

func TestTumblrArticles(t *testing.T) {
	long := "<p>" + strings.Repeat("word ", MaxWords+5) + "</p>"
	yt := `<p>watch this</p><iframe src="https://www.youtube.com/embed/abc"></iframe>`
	for name, body := range map[string]string{"long text": long, "youtube embed": yt, "empty": "<p> </p>"} {
		t.Run(name, func(t *testing.T) {
			if post, _ := Tumblr(Input{Author: "A", Body: body}); post != nil {
				t.Errorf("got a post, want an article")
			}
		})
	}
}

func TestTumblrBlog(t *testing.T) {
	tests := []struct{ in, want string }{
		{"https://frozjen.tumblr.com/post/831579310931476480/slug", "frozjen"},
		{"https://www.tumblr.com/paradnightstudio/832449024614383616/slug", "paradnightstudio"},
		{"https://example.com/post/1", ""},
	}
	for _, tt := range tests {
		if got := tumblrBlog(tt.in); got != tt.want {
			t.Errorf("tumblrBlog(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestTumblrFurnitureAndLinks(t *testing.T) {
	body := `<p><a class="tumblr_blog" href="https://www.thewakingcloak.com/post/1/slug">thewakingcloak</a>:</p><blockquote>` +
		`<div class="npf_row"><figure class="tmblr-full" data-orig-height="210" data-orig-width="540"><img src="https://64.media.tumblr.com/a.gif" alt="a tortoise"/><span class="tmblr-alt-text-helper">ALT</span></figure></div>` +
		`<p>do the Choppy Torte</p>` +
		`<p class="npf_link" data-npf="{&quot;type&quot;:&quot;link&quot;,&quot;url&quot;:&quot;https://store.steampowered.com/app/1/&quot;,&quot;title&quot;:&quot;A game&quot;,&quot;site_name&quot;:&quot;store.steampowered.com&quot;}"><a href="https://store.steampowered.com/app/1/">A game</a></p>` +
		`</blockquote>`
	post, _ := Tumblr(Input{Author: "A", Body: body})
	if post == nil || post.Quote == nil {
		t.Fatal("want a reblog post")
	}
	q := post.Quote
	if got := richtext.Plain(q.Segments); got != "do the Choppy Torte" {
		t.Errorf("quote text = %q", got)
	}
	if q.Author.Handle != "thewakingcloak" || q.Author.URL != "https://www.thewakingcloak.com/" {
		t.Errorf("custom-domain author = %+v", q.Author)
	}
	if q.Link == nil || q.Link.Title != "A game" || q.Link.Domain != "store.steampowered.com" {
		t.Errorf("link = %+v", q.Link)
	}
	if len(q.Images) != 1 || q.Images[0].Aspect == 0 || q.Images[0].Alt != "a tortoise" {
		t.Errorf("images = %+v", q.Images)
	}
}

// A reblog with no words of its own, of a post that is only a video, still has
// (empty) segments on both levels: the client maps over them (#216).
func TestTumblrEmptySegmentsAreLists(t *testing.T) {
	body := `<p><a class="tumblr_blog" href="https://gospelofsteel.tumblr.com/post/1/x">gospelofsteel</a>:</p><blockquote>` +
		`<figure class="tmblr-full" data-npf='{"type":"video","provider":"tumblr","url":"https://64.media.tumblr.com/v.mov","media":{"url":"https://64.media.tumblr.com/s720/v.mov","width":1920,"height":1080},"poster":[{"url":"https://44.media.tumblr.com/p.jpg"}]}'><video><source src="https://64.media.tumblr.com/v.mov"></video></figure></blockquote>`
	post, _ := Tumblr(Input{Author: "A", Body: body})
	if post == nil || post.Quote == nil || post.Quote.Video == nil {
		t.Fatalf("want a reblog of a video, got %+v", post)
	}
	raw := richtext.Marshal(post)
	if strings.Contains(raw, `"segments":null`) {
		t.Errorf("null segments in %s", raw)
	}
}
