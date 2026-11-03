package store

import (
	"context"
	"testing"
	"time"
)

// TestShortFormItems pins #209: a Substack item is a post exactly when ingest
// classified it as one, the form follows each re-fetch, its article columns are
// left alone, and an unclassified item is listed for the boot backfill.
func TestShortFormItems(t *testing.T) {
	db, uid := newTestDB(t)
	ctx := context.Background()
	s, err := db.CreateSource(ctx, &Source{UserID: uid, Kind: "substack", Title: "Pub", FeedURL: "https://x.substack.com/feed", State: "followed", Weight: 1})
	if err != nil {
		t.Fatal(err)
	}
	post := `{"author":{"name":"A"},"title":"Short","segments":[{"text":"two sentences."}]}`
	upsert := func(form, pj, content string) int64 {
		it := &Item{SourceID: s.ID, ExternalID: "p1", URL: "https://x.substack.com/p/short", Title: "Short", Content: content,
			PublishedAt: time.Now().UTC(), Form: form, PostJSON: pj}
		if _, err := db.UpsertItem(ctx, it); err != nil {
			t.Fatal(err)
		}
		var id int64
		if err := db.sql.QueryRowContext(ctx, `SELECT id FROM items WHERE external_id = 'p1'`).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	get := func(id int64) *Item {
		it, err := db.GetItem(ctx, uid, id)
		if err != nil || it == nil {
			t.Fatalf("GetItem: %v %v", it, err)
		}
		return it
	}

	id := upsert("post", post, "<p>two sentences.</p>")
	if it := get(id); !it.Post || it.PostBody == nil || it.PostBody.Title != "Short" || it.Text != "two sentences." || it.Headline(120) != "Short" {
		t.Fatalf("post: %+v", it)
	}
	// Re-fetched as an article (it grew, or the threshold moved): no longer a post,
	// and the stored body is not rewritten by the post path.
	upsert("article", "", "<p>other</p>")
	if it := get(id); it.Post || it.PostBody != nil || it.Content != "<p>two sentences.</p>" {
		t.Fatalf("article: post %v body %v content %q", it.Post, it.PostBody, it.Content)
	}
	if rows, err := db.UnclassifiedForms(ctx, 10); err != nil || len(rows) != 0 {
		t.Fatalf("classified item listed for backfill: %v %v", rows, err)
	}
	// An item stored before #209 has no form until the backfill sets one.
	if _, err := db.sql.ExecContext(ctx, `UPDATE items SET form = '' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	rows, err := db.UnclassifiedForms(ctx, 10)
	if err != nil || len(rows) != 1 || rows[0].ID != id {
		t.Fatalf("backfill rows = %+v %v", rows, err)
	}
	if err := db.SetItemForm(ctx, id, "post", post); err != nil {
		t.Fatal(err)
	}
	if it := get(id); !it.Post {
		t.Fatal("backfilled post is not a post")
	}
}
