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

// #90: font_weight/meta_weight clamp to [300,700]; font_family/ink/meta_ink are
// curated enums that fall back to their default when given an unknown value.
func TestClampTypography(t *testing.T) {
	db, uid := newTestDB(t)
	ctx := context.Background()
	patch := []byte(`{"reader":{"font_weight":999,"font_family":"comic","ink":"neon"},"card":{"meta_weight":100,"meta_ink":"bogus"}}`)
	got, err := db.UpdatePreferences(ctx, uid, patch)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.Reader.FontWeight != 700 {
		t.Fatalf("font_weight not clamped to 700: %v", got.Reader.FontWeight)
	}
	if got.Card.MetaWeight != 300 {
		t.Fatalf("meta_weight not clamped to 300: %v", got.Card.MetaWeight)
	}
	if got.Reader.FontFamily != "charter" {
		t.Fatalf("unknown font_family should fall back to charter: %q", got.Reader.FontFamily)
	}
	if got.Reader.Ink != "soft" {
		t.Fatalf("unknown reader ink should fall back to soft: %q", got.Reader.Ink)
	}
	if got.Card.MetaInk != "mute" {
		t.Fatalf("unknown meta_ink should fall back to mute: %q", got.Card.MetaInk)
	}

	// A valid curated value is preserved.
	got, err = db.UpdatePreferences(ctx, uid, []byte(`{"reader":{"font_family":"didot","font_weight":525}}`))
	if err != nil {
		t.Fatalf("update2: %v", err)
	}
	if got.Reader.FontFamily != "didot" {
		t.Fatalf("valid font_family should persist: %q", got.Reader.FontFamily)
	}
	if got.Reader.FontWeight != 525 {
		t.Fatalf("in-range niche weight should persist: %v", got.Reader.FontWeight)
	}
}

// #97: per-element weight clamps to [300,700]; per-element ink is a curated enum
// (interest ink additionally allows "interest"); delim is an enum; delim_gap clamps.
func TestClampPerElementMeta(t *testing.T) {
	db, uid := newTestDB(t)
	ctx := context.Background()
	patch := []byte(`{"card":{"interest_weight":999,"interest_ink":"neon","source_weight":100,` +
		`"author_ink":"bogus","date_weight":800,"delim":"emoji","delim_gap":99}}`)
	got, err := db.UpdatePreferences(ctx, uid, patch)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.Card.InterestWeight != 700 {
		t.Fatalf("interest_weight not clamped to 700: %v", got.Card.InterestWeight)
	}
	if got.Card.InterestInk != "interest" {
		t.Fatalf("unknown interest_ink should fall back to interest: %q", got.Card.InterestInk)
	}
	if got.Card.SourceWeight != 300 {
		t.Fatalf("source_weight not clamped to 300: %v", got.Card.SourceWeight)
	}
	if got.Card.AuthorInk != "mute" {
		t.Fatalf("unknown author_ink should fall back to mute: %q", got.Card.AuthorInk)
	}
	if got.Card.DateWeight != 700 {
		t.Fatalf("date_weight not clamped to 700: %v", got.Card.DateWeight)
	}
	if got.Card.Delim != "dot" {
		t.Fatalf("unknown delim should fall back to dot: %q", got.Card.Delim)
	}
	if got.Card.DelimGap != 16 {
		t.Fatalf("delim_gap not clamped to 16: %v", got.Card.DelimGap)
	}

	// A valid interest ink override + delim glyph persists.
	got, err = db.UpdatePreferences(ctx, uid, []byte(`{"card":{"interest_ink":"graphite","delim":"pipe"}}`))
	if err != nil {
		t.Fatalf("update2: %v", err)
	}
	if got.Card.InterestInk != "graphite" || got.Card.Delim != "pipe" {
		t.Fatalf("valid interest_ink/delim should persist: %q %q", got.Card.InterestInk, got.Card.Delim)
	}
}

// #97: a pre-#97 blob (shared meta_weight/meta_ink, no per-element keys) folds the
// customized shared value into the author + date parts on read, leaving interest +
// source at their designed defaults. A default shared value leaves everything
// at the designed per-element defaults.
func TestMigrateLegacyMeta(t *testing.T) {
	t.Run("customized shared meta folds into author+date", func(t *testing.T) {
		db, uid := newTestDB(t)
		ctx := context.Background()
		// Write a legacy blob directly (no per-element keys, customized shared meta).
		if err := db.kvSet(ctx, uid, settingPreferences, `{"card":{"meta_weight":700,"meta_ink":"ink"}}`); err != nil {
			t.Fatalf("seed: %v", err)
		}
		got, err := db.GetPreferences(ctx, uid)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if got.Card.AuthorWeight != 700 || got.Card.DateWeight != 700 {
			t.Fatalf("author/date weight should inherit legacy 700: %v %v", got.Card.AuthorWeight, got.Card.DateWeight)
		}
		if got.Card.AuthorInk != "ink" || got.Card.DateInk != "ink" {
			t.Fatalf("author/date ink should inherit legacy ink: %q %q", got.Card.AuthorInk, got.Card.DateInk)
		}
		if got.Card.InterestWeight != 600 || got.Card.SourceWeight != 600 {
			t.Fatalf("interest/source weight should keep designed defaults: %v %v", got.Card.InterestWeight, got.Card.SourceWeight)
		}
		if got.Card.InterestInk != "interest" || got.Card.SourceInk != "soft" {
			t.Fatalf("interest/source ink should keep designed defaults: %q %q", got.Card.InterestInk, got.Card.SourceInk)
		}
	})

	t.Run("default legacy blob keeps designed defaults", func(t *testing.T) {
		db, uid := newTestDB(t)
		ctx := context.Background()
		if err := db.kvSet(ctx, uid, settingPreferences, `{"reader":{"font_size":18}}`); err != nil {
			t.Fatalf("seed: %v", err)
		}
		got, err := db.GetPreferences(ctx, uid)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		def := DefaultPreferences().Card
		if got.Card.AuthorWeight != def.AuthorWeight || got.Card.DateInk != def.DateInk {
			t.Fatalf("default legacy blob should keep designed per-element defaults")
		}
	})

	t.Run("per-element blob is not re-migrated", func(t *testing.T) {
		db, uid := newTestDB(t)
		ctx := context.Background()
		// Has a per-element key AND a customized shared meta; the shared meta must
		// NOT clobber the explicit per-element author weight.
		blob := `{"card":{"meta_weight":700,"author_weight":450,"date_weight":460}}`
		if err := db.kvSet(ctx, uid, settingPreferences, blob); err != nil {
			t.Fatalf("seed: %v", err)
		}
		got, err := db.GetPreferences(ctx, uid)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if got.Card.AuthorWeight != 450 || got.Card.DateWeight != 460 {
			t.Fatalf("explicit per-element weights should win over legacy meta: %v %v", got.Card.AuthorWeight, got.Card.DateWeight)
		}
	})
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
