package store

import (
	"context"
	"reflect"
	"testing"
)

func newTestDB(t *testing.T) (*DB, int64) {
	t.Helper()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	u, err := db.UpsertUserByUsername(context.Background(), "tester", "")
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	return db, u.ID
}

func TestGetPreferencesDefaults(t *testing.T) {
	db, uid := newTestDB(t)
	got, err := db.GetPreferences(context.Background(), uid)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !reflect.DeepEqual(got, DefaultPreferences()) {
		t.Fatalf("fresh user should get defaults, got %+v", got)
	}
}

func TestUpdatePreferencesMergePreservesUntouched(t *testing.T) {
	db, uid := newTestDB(t)
	ctx := context.Background()

	// Patch only the reader font size; everything else must keep its default.
	if _, err := db.UpdatePreferences(ctx, uid, []byte(`{"reader":{"font_size":20}}`)); err != nil {
		t.Fatalf("update1: %v", err)
	}
	got, err := db.GetPreferences(ctx, uid)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Reader.FontSize != 20 {
		t.Fatalf("font_size not applied: %v", got.Reader.FontSize)
	}
	if got.Reader.LineHeight != DefaultPreferences().Reader.LineHeight {
		t.Fatalf("line_height should keep default, got %v", got.Reader.LineHeight)
	}
	if got.Card.DateSize != DefaultPreferences().Card.DateSize {
		t.Fatalf("card date size should keep default, got %v", got.Card.DateSize)
	}

	// A second partial patch on a different subtree keeps the earlier one.
	if _, err := db.UpdatePreferences(ctx, uid, []byte(`{"card":{"hero_show":false}}`)); err != nil {
		t.Fatalf("update2: %v", err)
	}
	got, _ = db.GetPreferences(ctx, uid)
	if got.Reader.FontSize != 20 {
		t.Fatalf("earlier font_size lost after second patch: %v", got.Reader.FontSize)
	}
	if got.Card.HeroShow {
		t.Fatalf("hero_show should be false")
	}
}

func TestUpdatePreferencesClamps(t *testing.T) {
	db, uid := newTestDB(t)
	ctx := context.Background()
	got, err := db.UpdatePreferences(ctx, uid, []byte(`{"reader":{"font_size":999,"line_height":0.1,"measure":5}}`))
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.Reader.FontSize != 24 {
		t.Fatalf("font_size not clamped to 24: %v", got.Reader.FontSize)
	}
	if got.Reader.LineHeight != 1.2 {
		t.Fatalf("line_height not clamped to 1.2: %v", got.Reader.LineHeight)
	}
	if got.Reader.Measure != 28 {
		t.Fatalf("measure not clamped to 28: %v", got.Reader.Measure)
	}
}

func TestClampPresets(t *testing.T) {
	tests := []struct {
		name string
		in   []int
		want []int
	}{
		{"empty stays default", nil, []int{5, 15, 30, 60}},
		{"sorts and dedupes", []int{30, 5, 30, 15}, []int{5, 15, 30}},
		{"clamps range and snaps to 5", []int{2, 200, 63}, []int{5, 60, 120}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := clampPresets(tt.in)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %v want %v", got, tt.want)
			}
		})
	}
}
