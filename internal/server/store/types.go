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
	// Denormalized, populated by list queries for the UI.
	FeedSlugs   []string `json:"feed_slugs,omitempty"`
	ItemCount   int      `json:"item_count,omitempty"`
	UnseenCount int      `json:"unseen_count,omitempty"`
	SkipPct     float64  `json:"skip_pct"`      // fraction of shown items skipped (0..1)
	PostsPerDay float64  `json:"posts_per_day"` // avg items/day over the last 30 days
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
// belongs to at least one feed; a feedless source (e.g. a YouTube channel) gets
// a nil ref and the card renders source-only.
type FeedRef struct {
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	Color string `json:"color"`
	Icon  string `json:"icon"`
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

// Item is a normalized content event from a source.
type Item struct {
	ID           int64     `json:"id"`
	SourceID     int64     `json:"source_id"`
	ExternalID   string    `json:"-"`
	URL          string    `json:"url"`
	Title        string    `json:"title"`
	Summary      string    `json:"summary"` // short plain-text card preview
	Content      string    `json:"content"` // full body, raw HTML; sanitized client-side (#58)
	Author       string    `json:"author"`
	ThumbnailURL string    `json:"thumbnail_url"`
	MediaType    string    `json:"media_type"` // short | long | article | audio | live | unknown
	DurationSec  int       `json:"duration_sec"`
	PublishedAt  time.Time `json:"published_at"`
	FetchedAt    time.Time `json:"fetched_at"`
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
	// SourceCadence is the source's average items/day over the recent window;
	// used to boost rare sources and cap noisy ones.
	SourceCadence float64
	// SourceHalfLifeDays is the source's own freshness half-life override (#76),
	// resolved by the store. 0 = inherit; it takes precedence over the feed
	// half-life in the ranker (source override > feed > global).
	SourceHalfLifeDays float64
	// FeedHalfLifeDays / FeedDiversity are the item's resolved feed ranker
	// overrides (#17). FeedHalfLifeDays honors the multi-feed rule (#76): the
	// primary feed by default, or the shortest/longest among the source's feeds.
	// 0 means "use the global default" (freshness half-life) / "use the source's
	// own per-session cap".
	FeedHalfLifeDays float64
	FeedDiversity    int
}

// MultiFeedRule decides which feed supplies a source's freshness half-life when
// the source belongs to more than one feed (#76). It's a user preference; the
// store applies it while resolving a candidate's FeedHalfLifeDays. The full
// hierarchy is source override > feed (resolved by this rule) > global default.
type MultiFeedRule string

const (
	// RulePrimaryFeed uses the source's primary feed (lowest sort, then id),
	// matching how feed identity already resolves elsewhere. The default.
	RulePrimaryFeed MultiFeedRule = "primary"
	// RuleShortestHalfLife uses the feed with the shortest EFFECTIVE half-life
	// among the source's feeds - a feed inheriting the global default counts as
	// that default (not 0) in the comparison. Freshness-biased: items fade fastest.
	RuleShortestHalfLife MultiFeedRule = "shortest"
	// RuleLongestHalfLife uses the feed with the longest effective half-life.
	// Evergreen-biased: items linger longest.
	RuleLongestHalfLife MultiFeedRule = "longest"
)

// NormalizeMultiFeedRule coerces an arbitrary string to a known rule, defaulting
// to RulePrimaryFeed for empty/unknown input so a missing or malformed setting is
// always safe.
func NormalizeMultiFeedRule(s string) MultiFeedRule {
	switch MultiFeedRule(s) {
	case RuleShortestHalfLife:
		return RuleShortestHalfLife
	case RuleLongestHalfLife:
		return RuleLongestHalfLife
	default:
		return RulePrimaryFeed
	}
}
