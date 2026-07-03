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
	AddedAt       time.Time  `json:"added_at"`
	LastFetchAt   *time.Time `json:"last_fetch_at,omitempty"`
	FetchError    string     `json:"fetch_error,omitempty"`
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
	ID          int64     `json:"id"`
	UserID      int64     `json:"-"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	Color       string    `json:"color"`
	Icon        string    `json:"icon"` // flat glyph key; '' = unset (render color swatch)
	Sort        int       `json:"sort"`
	CreatedAt   time.Time `json:"created_at"`
	SourceCount int       `json:"source_count,omitempty"`
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

// Item is a normalized content event from a source.
type Item struct {
	ID           int64     `json:"id"`
	SourceID     int64     `json:"source_id"`
	ExternalID   string    `json:"-"`
	URL          string    `json:"url"`
	Title        string    `json:"title"`
	Summary      string    `json:"summary"`
	Author       string    `json:"author"`
	ThumbnailURL string    `json:"thumbnail_url"`
	MediaType    string    `json:"media_type"` // short | long | article | audio | live | unknown
	DurationSec  int       `json:"duration_sec"`
	PublishedAt  time.Time `json:"published_at"`
	FetchedAt    time.Time `json:"fetched_at"`
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
}
