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

// Source is a creator/channel: an RSS/Atom topic, a YouTube channel (its RSS),
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
	// applies source override > topic (resolved) > global default.
	HalfLifeDays float64 `json:"half_life_days"`
	// Archive After (#115): 0 = inherit topic default, -1 = evergreen, N = days.
	ArchiveAfterDays int `json:"archive_after_days"`
	// Rule-based per-source archive (#124). ArchiveKeepCount is the keep-latest-N
	// count rule: 0 = off, N = keep the newest N eligible items. ArchiveCombine is
	// how the age and count rules combine when BOTH are active: "and" (default) or
	// "or". Per-source only - topics/global stay age-only.
	ArchiveKeepCount int    `json:"archive_keep_count"`
	ArchiveCombine   string `json:"archive_combine"`
	// Per-source article scoring config (#124), stored as JSON. "" = default
	// (newest, no facets), which is byte-identical to today's pure-recency order.
	ScoringConfig string `json:"scoring_config,omitempty"`
	// Auto-archive keywords (#118): comma-separated, case-insensitive.
	ArchiveKeywords string     `json:"archive_keywords"`
	AddedAt         time.Time  `json:"added_at"`
	LastFetchAt     *time.Time `json:"last_fetch_at,omitempty"`
	FetchError      string     `json:"fetch_error,omitempty"`
	// The one topic this source belongs to (#86). TopicID is nil for a topicless
	// source; TopicSlug is the denormalized slug for the UI ("" when topicless).
	TopicID     *int64  `json:"topic_id,omitempty"`
	TopicSlug   string  `json:"topic_slug,omitempty"`
	ItemCount   int     `json:"item_count,omitempty"`
	UnseenCount int     `json:"unseen_count,omitempty"`
	SkipPct     float64 `json:"skip_pct"`      // fraction of shown items skipped (0..1)
	PostsPerDay float64 `json:"posts_per_day"` // avg items/day over the last 30 days
}

// Topic is a theme/collection ("Comedy", "Local News") - a saved grouping of
// sources the session builder can target.
type Topic struct {
	ID     int64  `json:"id"`
	UserID int64  `json:"-"`
	Name   string `json:"name"`
	Slug   string `json:"slug"`
	Color  string `json:"color"`
	Icon   string `json:"icon"` // flat glyph key; '' = unset (render color swatch)
	// Per-topic freshness override (#17). HalfLifeDays 0 = use the global freshness
	// half-life. (A per-topic "diversity" cap existed pre-engine-v2; the allocator
	// no longer reads it, so it was removed - the topics.diversity column is inert.)
	HalfLifeDays float64 `json:"half_life_days"`
	// Archive After default for this topic's sources (#115): 0 = global default,
	// -1 = evergreen, N = days. A source's own archive_after_days overrides it.
	ArchiveAfterDays int `json:"archive_after_days"`
	// The one section this topic belongs to (#130 strict tree). SectionID is nil only
	// transiently before enforceTree routes an orphan to Uncategorized; SectionSlug /
	// SectionName are denormalized for the "part of the X section" UI.
	SectionID   *int64    `json:"section_id,omitempty"`
	SectionSlug string    `json:"section_slug,omitempty"`
	SectionName string    `json:"section_name,omitempty"`
	Sort        int       `json:"sort"`
	CreatedAt   time.Time `json:"created_at"`
	SourceCount int       `json:"source_count,omitempty"`
	// Articles published across this topic's sources in the last 30 days (#136) - a
	// predictor of "what following this means", surfaced as an activity indicator.
	ArticlesPerMonth int `json:"articles_per_month,omitempty"`
}

// TopicRef is the compact topic identity attached to a session item so the card
// can lead with "which topic is this". Populated only when the item's source
// belongs to a topic; a topicless source (e.g. a YouTube channel with no topic) gets
// a nil ref and the card renders source-only.
type TopicRef struct {
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	Color string `json:"color"`
	Icon  string `json:"icon"`
}

// Section is a user-created overlay gathering several topics under one name (#86):
// "News" = Local + International. Many-to-many - a topic can be in several sections.
// TopicCount is the denormalized membership size for the management list.
type Section struct {
	ID         int64     `json:"id"`
	UserID     int64     `json:"-"`
	Name       string    `json:"name"`
	Slug       string    `json:"slug"`
	Icon       string    `json:"icon"`
	Sort       int       `json:"sort"`
	CreatedAt  time.Time `json:"created_at"`
	TopicCount int       `json:"topic_count"`
}

// Collection is a named list of saved items (#57). Builtins (Saved, Watch
// Later, Liked) are seeded per user and protected from rename/delete; the rest
// are user-created. Unlike a topic (a grouping of sources), a collection sections
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
	ContentSource string `json:"content_source"`
	Author        string `json:"author"`
	ThumbnailURL  string `json:"thumbnail_url"`
	MediaType     string `json:"media_type"` // short | long | article | audio | live | unknown
	DurationSec   int    `json:"duration_sec"`
	// AspectRatio is the video frame's width/height (1.778 = 16:9, 0.5625 = 9:16),
	// from the YouTube API player embedHtml. Drives vertical-vs-landscape layout
	// independent of the short/long duration bucket. 0 = unknown (client defaults).
	AspectRatio float64   `json:"aspect_ratio"`
	PublishedAt time.Time `json:"published_at"`
	FetchedAt   time.Time `json:"fetched_at"`
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
	// SourceHalfLifeDays is the source's own freshness half-life override (#76),
	// resolved by the store. 0 = inherit; it takes precedence over the topic
	// half-life in the freshness score (source override > topic > global).
	SourceHalfLifeDays float64
	// TopicHalfLifeDays is the item's topic freshness-half-life override (#17),
	// resolved from the source's one topic (#86). 0 = use the global default. Read
	// by the freshness score (halfLifeOf); Archive-After governs eligibility separately.
	TopicHalfLifeDays float64
	// Archive After (session engine v2, #115): eligibility expiration window in
	// days. Source override > topic default > global. 0 = inherit up the chain;
	// -1 = evergreen (never archive); N = archive articles older than N days.
	SourceArchiveAfterDays int
	TopicArchiveAfterDays  int
	// SourceArchiveKeywords is the source's comma-separated auto-archive keyword
	// list (#118): an item matching any keyword is ineligible.
	SourceArchiveKeywords string
	// Rule-based archive (#124): the source's keep-latest-N count rule (0 = off)
	// and how it combines with the age rule ("and" | "or"). Per-source only.
	SourceArchiveKeepCount int
	SourceArchiveCombine   string
	// RecencyRank is the item's 1-based recency position among its source's UNSEEN
	// items (newest = 1), computed in SQL over the candidate set. The count rule
	// (#124) keeps items whose rank is <= the keep-count. Keyword-clean filtering is
	// applied in Go (eligible()), so the rank counts keyword-matched items too; that
	// only ever over-counts the window slightly, which is the conservative direction.
	RecencyRank int
	// ScoringConfig is the source's per-source article-scoring JSON (#124). "" =
	// default (newest, no facets). Parsed by session/facets.go.
	ScoringConfig string
}
