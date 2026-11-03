package store

import (
	"context"
	"testing"
	"time"
)

func TestPostText(t *testing.T) {
	tests := []struct {
		name, title, summary, want string
	}{
		{"one line", "just a thought", "", "just a thought"},
		{"first line plus rest", "headline line", "second line\nthird", "headline line\nsecond line\nthird"},
		{"clipped title repeats the text", "a long first line that was…", "a long first line that was clipped here", "a long first line that was clipped here"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := PostText(tt.title, tt.summary); got != tt.want {
				t.Errorf("PostText = %q, want %q", got, tt.want)
			}
		})
	}
}

// TestItemsCarrySourceKind pins #205: every item read the card, reader, history
// and collections render from carries its source kind, and a Bluesky item is a
// post with its whole text.
func TestItemsCarrySourceKind(t *testing.T) {
	db, uid := newTestDB(t)
	ctx := context.Background()
	mk := func(kind, title, summary string) (int64, int64) {
		s, err := db.CreateSource(ctx, &Source{UserID: uid, Kind: kind, Title: kind, FeedURL: "x:" + kind, State: "followed", Weight: 1})
		if err != nil {
			t.Fatal(err)
		}
		it := &Item{SourceID: s.ID, ExternalID: kind, URL: "u/" + kind, Title: title, Summary: summary, PublishedAt: time.Now().UTC()}
		if _, err := db.UpsertItem(ctx, it); err != nil {
			t.Fatal(err)
		}
		var id int64
		if err := db.sql.QueryRowContext(ctx, `SELECT id FROM items WHERE external_id = ?`, kind).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return s.ID, id
	}
	_, rssID := mk("rss", "An article", "The dek")
	_, postID := mk("bluesky", "First line", "and the rest")

	cs, err := db.CandidatesByIDs(ctx, uid, []int64{rssID, postID})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cs {
		switch c.ID {
		case rssID:
			if c.SourceKind != "rss" || c.Post || c.Text != "" {
				t.Errorf("rss candidate = kind %q post %v text %q", c.SourceKind, c.Post, c.Text)
			}
		case postID:
			if c.SourceKind != "bluesky" || !c.Post || c.Text != "First line\nand the rest" {
				t.Errorf("post candidate = kind %q post %v text %q", c.SourceKind, c.Post, c.Text)
			}
		}
	}
	got, err := db.GetItem(ctx, uid, postID)
	if err != nil || got == nil {
		t.Fatalf("GetItem: %v %v", got, err)
	}
	if !got.Post || got.SourceKind != "bluesky" {
		t.Errorf("GetItem = kind %q post %v", got.SourceKind, got.Post)
	}
	if err := db.SetItemState(ctx, uid, postID, "opened"); err != nil {
		t.Fatal(err)
	}
	hist, err := db.History(ctx, uid, "shown", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(hist) != 1 || !hist[0].Post || hist[0].SourceKind != "bluesky" {
		t.Errorf("history = %+v", hist)
	}
}

func TestHeadline(t *testing.T) {
	long := Item{Post: true, Text: "one two three four five six seven eight nine ten", Title: "one two"}
	if got := long.Headline(20); got != "one two three four…" {
		t.Errorf("long post headline = %q", got)
	}
	short := Item{Post: true, Text: "short\npost", Title: "short"}
	if got := short.Headline(20); got != "short post" {
		t.Errorf("short post headline = %q", got)
	}
	art := Item{Title: "An article"}
	if got := art.Headline(5); got != "An article" {
		t.Errorf("article headline = %q", got)
	}
}

func TestPostTextFromBody(t *testing.T) {
	tests := []struct {
		name, body, want string
	}{
		{"paragraphs kept", "<p>First line<br><br>a second &amp; third<br>line</p><p><img src=\"x\"></p>", "First line\n\na second & third\nline"},
		{"link-only post", `<p><a href="https://x">Title</a></p>`, ""},
		{"image-only post", `<p><img src="x" alt=""></p>`, ""},
		{"not a post body", "plain", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := postTextFromBody(tt.body); got != tt.want {
				t.Errorf("postTextFromBody = %q, want %q", got, tt.want)
			}
		})
	}
}
