package store

import (
	"context"
	"testing"
)

// TestHistoryFilters verifies the four history filters (#83) select the right
// item_state slice and that the endpoint is a pure read-only projection: it
// never writes item_state, so the states set here are exactly what comes back.
func TestHistoryFilters(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	u, err := db.UpsertUserByUsername(ctx, "tester", "")
	if err != nil {
		t.Fatal(err)
	}

	// Five items across the interaction spectrum.
	surfaced := seedItem(t, db, u.ID, "surfaced") // shown only, never acted
	opened := seedItem(t, db, u.ID, "opened")
	liked := seedItem(t, db, u.ID, "liked")
	saved := seedItem(t, db, u.ID, "saved")
	skipped := seedItem(t, db, u.ID, "skipped")

	// Everything gets surfaced first (the session marks seen-on-view), then some
	// are acted on - mirrors the real flow.
	if err := db.MarkSurfaced(ctx, u.ID, []int64{surfaced, opened, liked, saved, skipped}); err != nil {
		t.Fatal(err)
	}
	for id, st := range map[int64]string{
		opened:  "opened",
		liked:   "liked",
		saved:   "saved",
		skipped: "skipped",
	} {
		if err := db.SetItemState(ctx, u.ID, id, st); err != nil {
			t.Fatal(err)
		}
	}

	ids := func(hs []HistoryItem) map[int64]string {
		m := map[int64]string{}
		for _, h := range hs {
			m[h.ID] = h.State
		}
		return m
	}

	tests := []struct {
		name    string
		filter  string
		want    []int64
		notWant []int64
	}{
		{"shown includes everything surfaced", "shown", []int64{surfaced, opened, liked, saved, skipped}, nil},
		{"read is opened/liked/saved, not skipped/surfaced-only", "read", []int64{opened, liked, saved}, []int64{skipped, surfaced}},
		{"liked only", "liked", []int64{liked}, []int64{opened, saved, skipped, surfaced}},
		{"saved only", "saved", []int64{saved}, []int64{opened, liked, skipped, surfaced}},
		{"unknown filter falls back to shown", "bogus", []int64{surfaced, opened, liked, saved, skipped}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := db.History(ctx, u.ID, tt.filter, 100, 0)
			if err != nil {
				t.Fatal(err)
			}
			m := ids(got)
			for _, id := range tt.want {
				if _, ok := m[id]; !ok {
					t.Errorf("filter %q: expected item %d present, got %+v", tt.filter, id, m)
				}
			}
			for _, id := range tt.notWant {
				if _, ok := m[id]; ok {
					t.Errorf("filter %q: item %d should be absent, got %+v", tt.filter, id, m)
				}
			}
		})
	}

	// Every returned item carries a non-zero interaction timestamp and its state.
	got, err := db.History(ctx, u.ID, "shown", 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range got {
		if h.InteractedAt.IsZero() {
			t.Errorf("item %d has zero InteractedAt", h.ID)
		}
		if h.State == "" {
			t.Errorf("item %d has empty State", h.ID)
		}
	}
}

// TestHistoryPagination verifies limit/offset drive a stable "load more" window.
func TestHistoryPagination(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	u, err := db.UpsertUserByUsername(ctx, "tester", "")
	if err != nil {
		t.Fatal(err)
	}
	var all []int64
	for i := 0; i < 5; i++ {
		all = append(all, seedItem(t, db, u.ID, string(rune('a'+i))))
	}
	if err := db.MarkSurfaced(ctx, u.ID, all); err != nil {
		t.Fatal(err)
	}

	page1, err := db.History(ctx, u.ID, "shown", 2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(page1) != 2 {
		t.Fatalf("page1 len = %d, want 2", len(page1))
	}
	page2, err := db.History(ctx, u.ID, "shown", 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(page2) != 2 {
		t.Fatalf("page2 len = %d, want 2", len(page2))
	}
	// No overlap between pages.
	seen := map[int64]bool{page1[0].ID: true, page1[1].ID: true}
	if seen[page2[0].ID] || seen[page2[1].ID] {
		t.Errorf("page2 overlaps page1: %v vs %v", page2, page1)
	}
}
