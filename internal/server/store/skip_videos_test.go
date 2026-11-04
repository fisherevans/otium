package store

import (
	"context"
	"reflect"
	"testing"
)

func TestSkipSessionVideos(t *testing.T) {
	db, uid := newTestDB(t)
	ctx := context.Background()
	kinds := []string{"article", "short", "long", "short", "article", "live", "article"}
	ids := make([]int64, len(kinds))
	for i, k := range kinds {
		ids[i] = seedItem(t, db, uid, "i"+string(rune('a'+i)))
		db.sql.ExecContext(ctx, `UPDATE items SET media_type = ? WHERE id = ?`, k, ids[i])
	}
	if err := db.CreateSession(ctx, "s1", uid, 15, nil, ids); err != nil {
		t.Fatal(err)
	}
	s, err := db.SkipSessionVideos(ctx, uid, "s1", 1)
	if err != nil || s == nil {
		t.Fatalf("skip: %v %v", s, err)
	}
	// Position 0 was already seen and stays; from 1 on only the articles remain.
	want := []int64{ids[0], ids[4], ids[6]}
	if !reflect.DeepEqual(s.ItemIDs, want) || s.Cursor != 1 {
		t.Errorf("got %v cursor %d, want %v cursor 1", s.ItemIDs, s.Cursor, want)
	}
	stored, _ := db.GetSession(ctx, uid, "s1")
	if !reflect.DeepEqual(stored.ItemIDs, want) || stored.Cursor != 1 {
		t.Errorf("stored %v cursor %d", stored.ItemIDs, stored.Cursor)
	}
	db.EndSession(ctx, uid, "s1")
	if s, _ := db.SkipSessionVideos(ctx, uid, "s1", 0); s != nil {
		t.Errorf("ended session changed")
	}
}
