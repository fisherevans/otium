package store

import (
	"context"
	"encoding/json"
	"log/slog"
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

// CardPrefs tunes the swipe card (#81/#90/#97). The four size fields are px;
// hero_show hides the media block; hero_color switches the hero between color and
// the default grayscale/dither treatment.
//
// #97 replaced the single shared meta weight/ink with PER-ELEMENT weight+ink for
// each of the four meta parts (interest pill, source, author, date), plus a byline
// delimiter control (glyph + spacing). Each element keeps its existing size field.
// The legacy MetaWeight/MetaInk fields are retained as the migration seed only:
// GetPreferences folds a customized shared value into the author/date per-element
// fields for old blobs (the two elements the shared control actually drove in the
// v0.29 card), then the per-element fields own the styling going forward.
type CardPrefs struct {
	MetaSize        float64 `json:"meta_size"`         // author line size, px (was the shared sub-text size)
	SourceSize      float64 `json:"source_size"`       // source label, px
	InterestTagSize float64 `json:"interest_tag_size"` // interest pill name, px
	DateSize        float64 `json:"date_size"`         // date, px
	HeroShow        bool    `json:"hero_show"`         // show the hero/media block
	HeroColor       bool    `json:"hero_color"`        // true = color; false = grayscale/dither (default)

	// #97 per-element weight (300-700) + ink (curated enum). InterestInk additionally
	// allows "interest" = keep the interest's own color tint (the default, distinctive look).
	InterestWeight int    `json:"interest_weight"`
	InterestInk    string `json:"interest_ink"`
	SourceWeight   int    `json:"source_weight"`
	SourceInk      string `json:"source_ink"`
	AuthorWeight   int    `json:"author_weight"`
	AuthorInk      string `json:"author_ink"`
	DateWeight     int    `json:"date_weight"`
	DateInk        string `json:"date_ink"`

	// #97 byline delimiter: the separator between author and date. Delim is a
	// curated glyph key (dot|pipe|slash|space); DelimGap is the byline spacing, px.
	Delim    string `json:"delim"`
	DelimGap int    `json:"delim_gap"`

	// Legacy shared meta controls (pre-#97). Kept for back-compat migration only;
	// no longer surfaced in the UI. See migrateLegacyMeta.
	MetaWeight int    `json:"meta_weight"` // identity/date weight (#90), 300-700
	MetaInk    string `json:"meta_ink"`    // identity/date ink key (#90)
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
			MetaSize: 11, SourceSize: 11, InterestTagSize: 13, DateSize: 13,
			HeroShow: true, HeroColor: false,
			// #97 per-element defaults mirror the v0.29 card's designed look exactly:
			// interest pill 600 + interest-color tint, source 600 + soft, author 500 + mute,
			// date 400 + mute. So a fresh user (and one who never touched the old
			// shared control) sees no change.
			InterestWeight: 600, InterestInk: "interest",
			SourceWeight: 600, SourceInk: "soft",
			AuthorWeight: 500, AuthorInk: "mute",
			DateWeight: 400, DateInk: "mute",
			Delim: "dot", DelimGap: 7,
			MetaWeight: 400, MetaInk: "mute",
		},
		Presets: []int{5, 10, 20, 40},
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
		// default; a malformed blob leaves the defaults intact (but is worth a log -
		// it means a user's stored prefs silently reverted).
		if err := json.Unmarshal([]byte(v), &p); err != nil {
			slog.Warn("preferences: malformed stored blob, using defaults", "user", userID, "err", err)
		}
		migrateLegacyMeta(&p.Card, []byte(v))
	}
	clampPreferences(&p)
	return p, nil
}

// migrateLegacyMeta folds a pre-#97 blob's shared meta_weight/meta_ink into the
// new per-element fields so an existing user's card doesn't shift on upgrade. In
// the v0.29 card the shared control only drove the AUTHOR and DATE parts (interest
// pill + source were hardcoded 600 and not ink-tunable), so that's all it seeds.
// It only runs when the stored blob predates #97 (no per-element keys present) and
// the user had actually moved the shared control off its default; a fresh or
// already-migrated blob is left untouched.
func migrateLegacyMeta(p *CardPrefs, raw []byte) {
	var probe struct {
		Card struct {
			InterestWeight *int    `json:"interest_weight"`
			InterestInk    *string `json:"interest_ink"`
			SourceWeight   *int    `json:"source_weight"`
			SourceInk      *string `json:"source_ink"`
			AuthorWeight   *int    `json:"author_weight"`
			AuthorInk      *string `json:"author_ink"`
			DateWeight     *int    `json:"date_weight"`
			DateInk        *string `json:"date_ink"`
			Delim          *string `json:"delim"`
		} `json:"card"`
	}
	_ = json.Unmarshal(raw, &probe)
	c := probe.Card
	hasPerElement := c.InterestWeight != nil || c.InterestInk != nil || c.SourceWeight != nil ||
		c.SourceInk != nil || c.AuthorWeight != nil || c.AuthorInk != nil ||
		c.DateWeight != nil || c.DateInk != nil || c.Delim != nil
	if hasPerElement {
		return // already a #97-era blob; per-element fields own the styling
	}
	if p.MetaWeight != 400 { // customized shared weight -> author + date
		p.AuthorWeight = p.MetaWeight
		p.DateWeight = p.MetaWeight
	}
	if p.MetaInk != "" && p.MetaInk != "mute" { // customized shared ink -> author + date
		p.AuthorInk = p.MetaInk
		p.DateInk = p.MetaInk
	}
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
	p.Card.InterestTagSize = clampF(p.Card.InterestTagSize, 9, 20)
	p.Card.DateSize = clampF(p.Card.DateSize, 9, 22)
	p.Card.MetaWeight = clampI(p.Card.MetaWeight, 300, 700)
	p.Card.MetaInk = validEnum(p.Card.MetaInk, inkShades, "mute")
	// #97 per-element weight/ink. Interest ink additionally allows "interest" (keep tint).
	p.Card.InterestWeight = clampI(p.Card.InterestWeight, 300, 700)
	p.Card.InterestInk = validEnum(p.Card.InterestInk, interestInkShades, "interest")
	p.Card.SourceWeight = clampI(p.Card.SourceWeight, 300, 700)
	p.Card.SourceInk = validEnum(p.Card.SourceInk, inkShades, "soft")
	p.Card.AuthorWeight = clampI(p.Card.AuthorWeight, 300, 700)
	p.Card.AuthorInk = validEnum(p.Card.AuthorInk, inkShades, "mute")
	p.Card.DateWeight = clampI(p.Card.DateWeight, 300, 700)
	p.Card.DateInk = validEnum(p.Card.DateInk, inkShades, "mute")
	p.Card.Delim = validEnum(p.Card.Delim, delimGlyphs, "dot")
	p.Card.DelimGap = clampI(p.Card.DelimGap, 2, 16)
	p.Presets = clampPresets(p.Presets)
}

// Curated enum sets for the #90 typography controls. Keeping these server-side
// means a bad/stale client can't inject an arbitrary font stack or off-palette
// color: anything unrecognized falls back to the safe default. The client maps
// each key to a concrete system font stack / grayscale ink (prefsToVars).
var (
	fontFamilies = map[string]bool{"charter": true, "book": true, "didot": true, "grotesk": true}
	inkShades    = map[string]bool{"ink": true, "graphite": true, "soft": true, "mute": true}
	// #97: interest pill ink also allows "interest" = keep the interest's own color tint.
	interestInkShades = map[string]bool{"interest": true, "ink": true, "graphite": true, "soft": true, "mute": true}
	// #97: curated byline delimiter glyphs.
	delimGlyphs = map[string]bool{"dot": true, "pipe": true, "slash": true, "space": true}
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
		return []int{5, 10, 20, 40}
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
