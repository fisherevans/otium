package store

import (
	"context"
	"encoding/json"
	"sort"
)

// Preferences is the user's display-only appearance settings (#80/#81/#82).
//
// It is NEVER read by the ranker or the session builder - it only shapes how the
// reader and the session cards look, and which session-length presets the intent
// page offers. That boundary is load-bearing: prefs describe presentation, so
// changing them can never re-rank or re-select content.
//
// Persisted as one JSON blob in the kv table under settingPreferences, so there
// is no schema migration (kv is created in schema.sql and covers old databases).
// Every field has a server-side default (DefaultPreferences); GetPreferences
// merges the stored blob onto the defaults, so a fresh user gets today's look and
// a field a client omits keeps its default rather than zeroing out.
type Preferences struct {
	Reader  ReaderPrefs `json:"reader"`
	Card    CardPrefs   `json:"card"`
	Presets []int       `json:"presets"` // intent-page session-length chips, minutes
}

// ReaderPrefs tunes the in-app reader typography (#61/#90). Sizes are px, line
// height is unitless, measure is the max line length in ch (0 stays "full
// width"). FontFamily and Ink are curated enum keys (not free-form) so the UI
// stays on-theme; the client maps each key to a system font stack / grayscale
// ink value. FontWeight is a numeric weight (soft-snapped to common steps in the
// UI, but any value in range is allowed).
type ReaderPrefs struct {
	FontSize   float64 `json:"font_size"`   // body text size, px
	LineHeight float64 `json:"line_height"` // body line-height, unitless
	Measure    int     `json:"measure"`     // max line length, ch
	Images     bool    `json:"images"`      // render images inside the reader body
	FontFamily string  `json:"font_family"` // curated font key (#90): charter|book|didot|grotesk
	FontWeight int     `json:"font_weight"` // body weight (#90), 300-700
	Ink        string  `json:"ink"`         // curated ink key (#90): ink|graphite|soft|mute
}

// CardPrefs tunes the swipe card (#81/#90). The four size fields are px; hero_show
// hides the media block; hero_color switches the hero between color and the
// default grayscale/dither treatment. MetaWeight/MetaInk (#90) tune the identity
// line + card date - weight is numeric (300-700), ink is a curated enum key.
type CardPrefs struct {
	MetaSize    float64 `json:"meta_size"`     // sub-text / media-type meta, px
	SourceSize  float64 `json:"source_size"`   // source label, px
	FeedTagSize float64 `json:"feed_tag_size"` // feed identity tag, px
	DateSize    float64 `json:"date_size"`     // the date above the hero (#73), px
	HeroShow    bool    `json:"hero_show"`     // show the hero/media block
	HeroColor   bool    `json:"hero_color"`    // true = color; false = grayscale/dither (default)
	MetaWeight  int     `json:"meta_weight"`   // identity/date weight (#90), 300-700
	MetaInk     string  `json:"meta_ink"`      // identity/date ink key (#90)
}

// DefaultPreferences is the out-of-the-box look - the current e-ink theme's
// values, so a user who never opens the Appearance screen sees no change. Each
// number mirrors the corresponding rule in web/src/styles/global.css.
func DefaultPreferences() Preferences {
	return Preferences{
		Reader: ReaderPrefs{
			FontSize: 17, LineHeight: 1.62, Measure: 66, Images: true,
			FontFamily: "charter", FontWeight: 400, Ink: "soft",
		},
		Card: CardPrefs{
			MetaSize: 11, SourceSize: 11, FeedTagSize: 13, DateSize: 13,
			HeroShow: true, HeroColor: false,
			MetaWeight: 400, MetaInk: "mute",
		},
		Presets: []int{5, 15, 30, 60},
	}
}

const settingPreferences = "preferences"

// GetPreferences returns the user's appearance preferences, merged onto the
// defaults so any missing field falls back rather than zeroing. The stored blob
// is overlaid via json.Unmarshal (present keys win, absent keys keep defaults),
// then clamped to sane bounds.
func (db *DB) GetPreferences(ctx context.Context, userID int64) (Preferences, error) {
	p := DefaultPreferences()
	v, ok, err := db.kvGet(ctx, userID, settingPreferences)
	if err != nil {
		return p, err
	}
	if ok && v != "" {
		// Overlay stored values onto the defaults. Unknown/absent keys keep the
		// default; a malformed blob leaves the defaults intact.
		_ = json.Unmarshal([]byte(v), &p)
	}
	clampPreferences(&p)
	return p, nil
}

// UpdatePreferences merges a raw JSON patch onto the user's current preferences
// and persists the result. Merge (not replace): the patch only needs to carry
// the fields it changes; everything else is preserved. Returns the full, clamped
// preferences so the client can reconcile.
func (db *DB) UpdatePreferences(ctx context.Context, userID int64, patch []byte) (Preferences, error) {
	cur, err := db.GetPreferences(ctx, userID)
	if err != nil {
		return cur, err
	}
	if len(patch) > 0 {
		if err := json.Unmarshal(patch, &cur); err != nil {
			return cur, err
		}
	}
	clampPreferences(&cur)
	blob, err := json.Marshal(cur)
	if err != nil {
		return cur, err
	}
	if err := db.kvSet(ctx, userID, settingPreferences, string(blob)); err != nil {
		return cur, err
	}
	return cur, nil
}

// clampPreferences keeps every field inside a sane, display-safe range so a bad
// client (or a stale blob) can't produce an unreadable UI. Presets are clamped
// to [5,120], de-duplicated, sorted, capped at 8, and never left empty.
func clampPreferences(p *Preferences) {
	p.Reader.FontSize = clampF(p.Reader.FontSize, 13, 24)
	p.Reader.LineHeight = clampF(p.Reader.LineHeight, 1.2, 2.2)
	p.Reader.Measure = clampI(p.Reader.Measure, 28, 90)
	p.Reader.FontFamily = validEnum(p.Reader.FontFamily, fontFamilies, "charter")
	p.Reader.FontWeight = clampI(p.Reader.FontWeight, 300, 700)
	p.Reader.Ink = validEnum(p.Reader.Ink, inkShades, "soft")
	p.Card.MetaSize = clampF(p.Card.MetaSize, 8, 16)
	p.Card.SourceSize = clampF(p.Card.SourceSize, 8, 16)
	p.Card.FeedTagSize = clampF(p.Card.FeedTagSize, 9, 20)
	p.Card.DateSize = clampF(p.Card.DateSize, 9, 22)
	p.Card.MetaWeight = clampI(p.Card.MetaWeight, 300, 700)
	p.Card.MetaInk = validEnum(p.Card.MetaInk, inkShades, "mute")
	p.Presets = clampPresets(p.Presets)
}

// Curated enum sets for the #90 typography controls. Keeping these server-side
// means a bad/stale client can't inject an arbitrary font stack or off-palette
// color: anything unrecognized falls back to the safe default. The client maps
// each key to a concrete system font stack / grayscale ink (prefsToVars).
var (
	fontFamilies = map[string]bool{"charter": true, "book": true, "didot": true, "grotesk": true}
	inkShades    = map[string]bool{"ink": true, "graphite": true, "soft": true, "mute": true}
)

func validEnum(v string, allowed map[string]bool, def string) string {
	if allowed[v] {
		return v
	}
	return def
}

func clampPresets(in []int) []int {
	seen := map[int]bool{}
	var out []int
	for _, v := range in {
		v = clampI(v, 5, 120)
		// snap to the 5-minute grid the intent page steps on
		v = (v / 5) * 5
		if v < 5 {
			v = 5
		}
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Ints(out)
	if len(out) == 0 {
		return []int{5, 15, 30, 60}
	}
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

func clampF(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampI(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
