package store

import "time"

// User is an authenticated account. Single-tenant in practice, but everything
// hangs off a user so multi-tenant is a config flip later.
type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// Source is a creator/channel: an RSS/Atom feed, a YouTube channel (its RSS),
// or a podcast. Weight and PerSessionCap are the deterministic-control knobs.
type Source struct {
	ID            int64      `json:"id"`
	UserID        int64      `json:"-"`
	Kind          string     `json:"kind"` // rss | youtube | podcast
	Title         string     `json:"title"`
	FeedURL       string     `json:"feed_url"`
	HomepageURL   string     `json:"homepage_url"`
	IconURL       string     `json:"icon_url"`
	Weight        float64    `json:"weight"`
	State         string     `json:"state"` // suggested | trial | followed | archived
	TrialUntil    *time.Time `json:"trial_until,omitempty"`
	PerSessionCap int        `json:"per_session_cap"`
	// Per-source freshness half-life override (#76). 0 = inherit; the resolver
	// applies source override > feed (resolved) > global default.
	HalfLifeDays float64    `json:"half_life_days"`
	AddedAt      time.Time  `json:"added_at"`
	LastFetchAt  *time.Time `json:"last_fetch_at,omitempty"`
	FetchError   string     `json:"fetch_error,omitempty"`
	// The one feed this source belongs to (#86). FeedID is nil for a feedless
	// source; FeedSlug is the denormalized slug for the UI ("" when feedless).
	FeedID      *int64  `json:"feed_id,omitempty"`
	FeedSlug    string  `json:"feed_slug,omitempty"`
	ItemCount   int     `json:"item_count,omitempty"`
	UnseenCount int     `json:"unseen_count,omitempty"`
	SkipPct     float64 `json:"skip_pct"`      // fraction of shown items skipped (0..1)
	PostsPerDay float64 `json:"posts_per_day"` // avg items/day over the last 30 days
}

// Feed is a theme/collection ("Comedy", "Local News") - a saved grouping of
// sources the session builder can target.
type Feed struct {
	ID     int64  `json:"id"`
	UserID int64  `json:"-"`
	Name   string `json:"name"`
	Slug   string `json:"slug"`
	Color  string `json:"color"`
	Icon   string `json:"icon"` // flat glyph key; '' = unset (render color swatch)
	// Per-feed ranker overrides (#17). HalfLifeDays 0 = use the global freshness
	// half-life; Diversity 0 = use each source's own per-session cap.
	HalfLifeDays float64   `json:"half_life_days"`
	Diversity    int       `json:"diversity"`
	Sort         int       `json:"sort"`
	CreatedAt    time.Time `json:"created_at"`
	SourceCount  int       `json:"source_count,omitempty"`
}

// FeedRef is the compact feed identity attached to a session item so the card
// can lead with "which feed is this". Populated only when the item's source
// belongs to a feed; a feedless source (e.g. a YouTube channel with no feed) gets
// a nil ref and the card renders source-only.
type FeedRef struct {
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	Color string `json:"color"`
	Icon  string `json:"icon"`
}

// Group is a user-created overlay gathering several feeds under one name (#86):
// "News" = Local + International. Many-to-many - a feed can be in several groups.
// FeedCount is the denormalized membership size for the management list.
type Group struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"-"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	Icon      string    `json:"icon"`
	Sort      int       `json:"sort"`
	CreatedAt time.Time `json:"created_at"`
	FeedCount int       `json:"feed_count"`
}

// Collection is a named list of saved items (#57). Builtins (Saved, Watch
// Later, Liked) are seeded per user and protected from rename/delete; the rest
// are user-created. Unlike a feed (a grouping of sources), a collection groups
// items the user deliberately set aside.
type Collection struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"-"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	Kind      string    `json:"kind"` // builtin | user
	Sort      int       `json:"sort"`
	CreatedAt time.Time `json:"created_at"`
	ItemCount int       `json:"item_count"`
	// Contains is populated only when the list is fetched for a specific item
	// (the Save picker's membership checkmarks). nil otherwise.
	Contains *bool `json:"contains,omitempty"`
}

// Content-source provenance for an item's reader body (#98). Empty string is
// "pending" - not yet attempted. The on-demand content endpoint transitions a
// pending item to Fetched (readability extracted the article) or External (not
// extractable: video, paywall, JS-only). RSS is set at ingest / backfill.
const (
	ContentSourceRSS      = "rss"
	ContentSourceFetched  = "fetched"
	ContentSourceExternal = "external"
	ContentSourcePending  = "" // not yet attempted
)

// Item is a normalized content event from a source.
type Item struct {
	ID         int64  `json:"id"`
	SourceID   int64  `json:"source_id"`
	ExternalID string `json:"-"`
	URL        string `json:"url"`
	Title      string `json:"title"`
	Summary    string `json:"summary"` // short plain-text card preview
	Content    string `json:"content"` // full body, raw HTML; sanitized client-side (#58)
	// ContentSource is the reader body's provenance (#98): '' (pending) | rss |
	// fetched | external. Lets the card/reader pick content-aware actions (read
	// in-app vs open original vs watch) without inspecting the HTML.
	ContentSource string    `json:"content_source"`
	Author        string    `json:"author"`
	ThumbnailURL  string    `json:"thumbnail_url"`
	MediaType     string    `json:"media_type"` // short | long | article | audio | live | unknown
	DurationSec   int       `json:"duration_sec"`
	PublishedAt   time.Time `json:"published_at"`
	FetchedAt     time.Time `json:"fetched_at"`
}

// CollectionItem is an item paired with the timestamp it was added to a
// collection (#89). The collection review surface sorts by either AddedAt
// ("when I saved it") or the embedded Item.PublishedAt ("when it ran"), so both
// are carried. Membership is organization only - reading this never touches
// item_state, so the ranker is unaffected.
type CollectionItem struct {
	Item
	AddedAt time.Time `json:"added_at"`
}

// HistoryItem is an item paired with the user's interaction on it, for the
// personal history view (#83): "articles I've read versus just articles I've
// been shown." It is a read-only projection over item_state - the same table
// the ranker reads, but History never writes it and the ranker never reads
// History, so surfacing history can't perturb ranking (ItemEffectiveScore is
// untouched). State is the current item_state.state (surfaced | opened | liked
// | skipped | saved | dismissed). InteractedAt is the timestamp the query
// ordered by: surfaced_at for the "shown" filter, acted_at for the engaged
// (read/liked/saved) filters - i.e. when the interaction that put the item in
// this filter happened.
type HistoryItem struct {
	Item
	State        string    `json:"state"`
	InteractedAt time.Time `json:"interacted_at"`
}

// Session is a durable, stateful consumption session (#67): the built queue
// (ItemIDs, in order) plus the read Cursor into it, so a refresh or a return
// resumes the same items at the same place. Exactly one session per user is
// 'active'. DurationMin is the single chosen length (#69) the client paces
// against.
type Session struct {
	ID          string    `json:"id"`
	DurationMin int       `json:"duration_min"`
	Themes      []string  `json:"themes"`
	ItemIDs     []int64   `json:"-"`
	Cursor      int       `json:"cursor"`
	Status      string    `json:"status"` // active | ended
	CreatedAt   time.Time `json:"created_at"`
}

// Candidate is an item plus the source facts the ranker needs. It is the input
// to the session builder.
type Candidate struct {
	Item
	SourceTitle   string
	SourceWeight  float64
	PerSessionCap int
	// SourceCadence is the source's average items/day over the recent window,
	// computed from accumulated history. Informational (shown in the breakdown);
	// its RANK among the user's sources - not its absolute value - drives rarity.
	SourceCadence float64
	// RarityBoost is the source's population-relative rarity multiplier (#110),
	// in [1, 1+rareBoostMax]. The store ranks every followed/trial source's
	// cadence and hands the boost down here, so the ranker never re-derives it.
	// 0 means "unset" and the ranker treats it as 1 (no boost).
	RarityBoost float64
	// SourceHalfLifeDays is the source's own freshness half-life override (#76),
	// resolved by the store. 0 = inherit; it takes precedence over the feed
	// half-life in the ranker (source override > feed > global).
	SourceHalfLifeDays float64
	// FeedHalfLifeDays / FeedDiversity are the item's feed ranker overrides (#17),
	// resolved from the source's one feed (#86). 0 means "use the global default"
	// (freshness half-life) / "use the source's own per-session cap".
	FeedHalfLifeDays float64
	FeedDiversity    int
}
