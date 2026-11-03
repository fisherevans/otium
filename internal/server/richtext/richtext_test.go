package richtext

import (
	"encoding/json"
	"reflect"
	"testing"
)

func facet(start, end int, typ, key, val string) Facet {
	var f Facet
	f.Index.ByteStart, f.Index.ByteEnd = start, end
	raw := `{"$type":"app.bsky.richtext.facet#` + typ + `","` + key + `":` + mustJSON(val) + `}`
	f.Features = make([]struct {
		Type string `json:"$type"`
		URI  string `json:"uri"`
		DID  string `json:"did"`
		Tag  string `json:"tag"`
	}, 1)
	if err := json.Unmarshal([]byte(raw), &f.Features[0]); err != nil {
		panic(err)
	}
	return f
}

func mustJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestSegments(t *testing.T) {
	// The On the Media post from #207: a curly apostrophe (3 bytes) sits before
	// the link, so rune offsets would land the link three characters early.
	otm := "Struggling to figure out if an election story is true or false? Check out the election rumor rundown from the Center for an Informed Public and listen to our conversation with co-founder @katestarbird.bsky.social on this week’s show. lnk.to/onthemedia/b..."
	emoji := "\U0001F98B new post by @a.test see example.com/x… #ok"
	tests := []struct {
		name   string
		text   string
		facets []Facet
		want   []Segment
	}{
		{"no facets", "plain", nil, []Segment{{Text: "plain"}}},
		{"empty text", "", nil, nil},
		{
			"on the media: mention and shortened link, multibyte before",
			otm,
			[]Facet{
				facet(187, 212, "mention", "did", "did:plc:h3t5rqlvuaorq42yckpijirj"),
				facet(236, 258, "link", "uri", "https://lnk.to/onthemedia/bluesky"),
			},
			[]Segment{
				{Text: otm[:187]},
				{Text: "@katestarbird.bsky.social", Kind: "mention", Href: "https://bsky.app/profile/did:plc:h3t5rqlvuaorq42yckpijirj"},
				{Text: " on this week’s show. "},
				{Text: "lnk.to/onthemedia/b...", Kind: "link", Href: "https://lnk.to/onthemedia/bluesky"},
			},
		},
		{
			"emoji (4 bytes) first; mention, link and tag in reverse order",
			emoji,
			[]Facet{
				facet(46, 49, "tag", "tag", "ok"),
				facet(29, 45, "link", "uri", "https://example.com/x/full-path"),
				facet(17, 24, "mention", "did", "did:plc:a"),
			},
			[]Segment{
				{Text: "\U0001F98B new post by "},
				{Text: "@a.test", Kind: "mention", Href: "https://bsky.app/profile/did:plc:a"},
				{Text: " see "},
				{Text: "example.com/x…", Kind: "link", Href: "https://example.com/x/full-path"},
				{Text: " "},
				{Text: "#ok", Kind: "tag", Href: "https://bsky.app/hashtag/ok"},
			},
		},
		{
			"overlapping facet ignored, first wins",
			"abcdefgh",
			[]Facet{facet(0, 4, "link", "uri", "https://a.test"), facet(2, 6, "link", "uri", "https://b.test")},
			[]Segment{{Text: "abcd", Kind: "link", Href: "https://a.test"}, {Text: "efgh"}},
		},
		{
			"out of range, empty, reversed and negative ranges ignored",
			"short",
			[]Facet{
				facet(2, 99, "link", "uri", "https://a.test"),
				facet(3, 3, "link", "uri", "https://a.test"),
				facet(4, 1, "link", "uri", "https://a.test"),
				facet(-1, 2, "link", "uri", "https://a.test"),
			},
			[]Segment{{Text: "short"}},
		},
		{
			"range splitting a multibyte character ignored",
			"café time",
			[]Facet{facet(4, 6, "link", "uri", "https://a.test")}, // byte 4 is inside é
			[]Segment{{Text: "café time"}},
		},
		{
			"unsafe link scheme stays plain",
			"click me",
			[]Facet{facet(0, 5, "link", "uri", "javascript:alert(1)")},
			[]Segment{{Text: "click me"}},
		},
		{
			"hashtag with a leading # and non-ASCII tag is escaped",
			"#café",
			[]Facet{facet(0, 6, "tag", "tag", "#café")},
			[]Segment{{Text: "#café", Kind: "tag", Href: "https://bsky.app/hashtag/caf%C3%A9"}},
		},
		{
			"unknown feature type ignored",
			"hello",
			[]Facet{facet(0, 5, "bogus", "uri", "https://a.test")},
			[]Segment{{Text: "hello"}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Segments(tt.text, tt.facets)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("Segments =\n%#v\nwant\n%#v", got, tt.want)
			}
			if Plain(got) != tt.text {
				t.Fatalf("Plain = %q, want the original text %q", Plain(got), tt.text)
			}
		})
	}
}

func TestHTML(t *testing.T) {
	segs := []Segment{{Text: "a <b>\nnext "}, {Text: "x\"y", Kind: "link", Href: "https://a.test/?q=1&r=2"}}
	want := `a &lt;b&gt;<br>next <a href="https://a.test/?q=1&amp;r=2">x&#34;y</a>`
	if got := HTML(segs); got != want {
		t.Fatalf("HTML = %q, want %q", got, want)
	}
}

func TestBskyPost(t *testing.T) {
	tests := []struct {
		name  string
		embed string
		check func(t *testing.T, p *Post)
	}{
		{"external link card", `{"$type":"app.bsky.embed.external#view","external":{"uri":"https://www.lnk.to/x","title":"On the Media","description":"About the show","thumb":"https://t/1"}}`,
			func(t *testing.T, p *Post) {
				if p.Link == nil || p.Link.Domain != "lnk.to" || p.Link.Title != "On the Media" || p.Picture() != "https://t/1" {
					t.Fatalf("link = %+v", p.Link)
				}
			}},
		{"images with aspect", `{"$type":"app.bsky.embed.images#view","images":[{"thumb":"https://t/1","fullsize":"https://f/1","alt":"a","aspectRatio":{"width":1200,"height":800}},{"thumb":"https://t/2"}]}`,
			func(t *testing.T, p *Post) {
				if len(p.Images) != 2 || p.Images[0].Aspect != 1.5 || p.Images[1].Full != "https://t/2" {
					t.Fatalf("images = %+v", p.Images)
				}
			}},
		{"quote with media", `{"$type":"app.bsky.embed.recordWithMedia#view",
			"media":{"$type":"app.bsky.embed.images#view","images":[{"thumb":"https://t/m"}]},
			"record":{"record":{"$type":"app.bsky.embed.record#viewRecord","uri":"at://did:plc:q/app.bsky.feed.post/3q",
			  "author":{"did":"did:plc:q","handle":"q.test","displayName":"Quinn"},
			  "value":{"text":"quoted #tag","createdAt":"2026-11-01T00:00:00Z","facets":[{"index":{"byteStart":7,"byteEnd":11},"features":[{"$type":"app.bsky.richtext.facet#tag","tag":"tag"}]}]},
			  "embeds":[{"$type":"app.bsky.embed.external#view","external":{"uri":"https://x.test","thumb":"https://t/q"}}]}}}`,
			func(t *testing.T, p *Post) {
				if len(p.Images) != 1 || p.Quote == nil {
					t.Fatalf("post = %+v", p)
				}
				q := p.Quote
				if q.Author.Name != "Quinn" || q.URL != "https://bsky.app/profile/q.test/post/3q" || q.Media != "link" || q.Thumb != "https://t/q" {
					t.Fatalf("quote = %+v", q)
				}
				if len(q.Segments) != 2 || q.Segments[1].Kind != "tag" {
					t.Fatalf("quote segments = %+v", q.Segments)
				}
			}},
		{"blocked quote is not a quote", `{"$type":"app.bsky.embed.record#view","record":{"$type":"app.bsky.embed.record#viewBlocked","uri":"at://x"}}`,
			func(t *testing.T, p *Post) {
				if p.Quote != nil {
					t.Fatalf("quote = %+v", p.Quote)
				}
			}},
		{"video", `{"$type":"app.bsky.embed.video#view","playlist":"https://v/p.m3u8","thumbnail":"https://v/t.jpg","aspectRatio":{"width":9,"height":16}}`,
			func(t *testing.T, p *Post) {
				if p.Video == nil || p.Video.Thumb != "https://v/t.jpg" || p.Picture() != "https://v/t.jpg" {
					t.Fatalf("video = %+v", p.Video)
				}
			}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var e BskyEmbedView
			if err := json.Unmarshal([]byte(tt.embed), &e); err != nil {
				t.Fatal(err)
			}
			p := BskyPost(BskyAuthor{DID: "did:plc:a", Handle: "a.test", DisplayName: "Al"}, BskyRecord{Text: "hi"}, &e)
			if p.Author.URL != "https://bsky.app/profile/a.test" || p.Text() != "hi" {
				t.Fatalf("post = %+v", p)
			}
			tt.check(t, p)
			if back := Unmarshal(Marshal(p)); !reflect.DeepEqual(back, p) {
				t.Fatalf("round trip differs:\n%#v\n%#v", p, back)
			}
		})
	}
}
