package store

import (
	"context"
	"reflect"
	"testing"
	"time"
)

func TestItemTags(t *testing.T) {
	tests := []struct {
		name                       string
		categories, title, summary string
		want                       []string
	}{
		{"none", "", "Plain title", "", nil},
		{"categories", "Politics\nTech", "t", "", []string{"politics", "tech"}},
		{"hashtags", "", "Big jump #MTB #shorts", "more #mtb and #Cooking_Tips", []string{"mtb", "shorts", "cooking_tips"}},
		{"not a tag mid-word or single char", "", "C#sharp issue #1 and #a", "", nil},
		{"dedupe across", "MTB", "#mtb", "", []string{"mtb"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := itemTags(tt.categories, tt.title, tt.summary); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("tags = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestItemSignalLifecycle(t *testing.T) {
	db, uid := newTestDB(t)
	ctx := context.Background()
	item := seedItem(t, db, uid, "a")

	steps := []struct{ set, want string }{
		{"like", "like"}, {"like", "like"}, {"dislike", "dislike"}, {"", ""},
	}
	for _, s := range steps {
		got, err := db.SetItemSignal(ctx, uid, item, s.set)
		if err != nil {
			t.Fatal(err)
		}
		if got != s.want {
			t.Fatalf("set %q: got %q", s.set, got)
		}
		sig, _ := db.ItemSignals(ctx, uid, []int64{item})
		if sig[item] != s.want {
			t.Fatalf("stored after %q: %q", s.set, sig[item])
		}
	}
	// The repeated like is a no-op; switching logs the undo then the new signal.
	rows, err := db.sql.QueryContext(ctx, `SELECT type FROM events WHERE item_id = ? ORDER BY id`, item)
	if err != nil {
		t.Fatal(err)
	}
	var log []string
	for rows.Next() {
		var typ string
		rows.Scan(&typ)
		log = append(log, typ)
	}
	rows.Close()
	if want := []string{"like", "unlike", "dislike", "undislike"}; !reflect.DeepEqual(log, want) {
		t.Errorf("events = %q, want %q", log, want)
	}
	if _, err := db.SetItemSignal(ctx, uid, 99999, "like"); err != ErrItemNotFound {
		t.Errorf("unknown item: %v", err)
	}
}

func TestEngagementRollup(t *testing.T) {
	db, uid := newTestDB(t)
	ctx := context.Background()
	a := seedItem(t, db, uid, "a")
	b := seedItem(t, db, uid, "b")
	db.sql.ExecContext(ctx, `UPDATE items SET media_type = 'short', title = 'jump #mtb' WHERE id = ?`, a)
	now := time.Now().UTC()

	views := []struct {
		item int64
		v    ItemView
	}{
		// Watched a 40s short to 30s, then the same key re-sent with the final totals.
		{a, ItemView{ViewKey: "a1", ShownAt: now, DwellMs: 5000, ActiveMs: 4000, VideoLenSec: 40, MaxPosSec: 20, Plays: 1}},
		{a, ItemView{ViewKey: "a1", ShownAt: now, DwellMs: 9000, ActiveMs: 8000, VideoLenSec: 40, MaxPosSec: 30, Plays: 1, Pauses: 1}},
		// Watched to the end.
		{a, ItemView{ViewKey: "a2", ShownAt: now, DwellMs: 41000, ActiveMs: 40000, VideoLenSec: 40, MaxPosSec: 39, Plays: 1}},
		// Gone in half a second.
		{a, ItemView{ViewKey: "a3", ShownAt: now, DwellMs: 500}},
		// An article opened and read.
		{b, ItemView{ViewKey: "b1", ShownAt: now, DwellMs: 60000, Opened: true, ActiveMs: 55000, ScrollDepth: 0.8}},
		// Outside the range.
		{b, ItemView{ViewKey: "b0", ShownAt: now.AddDate(0, 0, -60), DwellMs: 300}},
	}
	for _, v := range views {
		if err := db.RecordItemView(ctx, uid, v.item, v.v); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.SetItemSignal(ctx, uid, a, "dislike"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SetItemSignal(ctx, uid, b, "like"); err != nil {
		t.Fatal(err)
	}

	from, to := now.AddDate(0, 0, -30), now.Add(time.Minute)
	rep, err := db.Engagement(ctx, uid, from, to, "source")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]EngagementRow{}
	for _, r := range rep.Rows {
		r.Key = ""
		got[r.Label] = r
	}
	median := 0.8625 // (30/40 + 39/40) / 2
	want := map[string]EngagementRow{
		"S-a": {Label: "S-a", Kind: "rss", Shown: 3, InstantSkips: 1, Videos: 3, MedianWatch: &median, Completed: 1, ActiveMin: 0.8, DwellMin: 0.84, Dislikes: 1},
		"S-b": {Label: "S-b", Kind: "rss", Shown: 1, Opened: 1, ActiveMin: 0.92, DwellMin: 1, Likes: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("by source:\n got %+v\nwant %+v", got, want)
	}

	tags, err := db.Engagement(ctx, uid, from, to, "tag")
	if err != nil {
		t.Fatal(err)
	}
	if len(tags.Rows) != 1 || tags.Rows[0].Label != "#mtb" || tags.Rows[0].Shown != 3 || tags.Rows[0].Dislikes != 1 {
		t.Errorf("by tag: %+v", tags.Rows)
	}

	// The player's length filled in the unknown duration.
	var dur int
	db.sql.QueryRowContext(ctx, `SELECT duration_sec FROM items WHERE id = ?`, a).Scan(&dur)
	if dur != 40 {
		t.Errorf("duration backfill: %d", dur)
	}
}
