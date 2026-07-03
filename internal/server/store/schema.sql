-- otium schema (SQLite).
--
-- The whole product is a session engine: normalize content from many sources
-- into `items`, then assemble a time-boxed, weighted, explainable session on
-- demand. The schema exists to serve one query - "given the user's sources,
-- weights, and history, what should they consume for the next N minutes" - so
-- it is deliberately relational: sources carry weights/cadence caps, items
-- carry duration + freshness, and per-item state tracks what has been surfaced.
--
-- Single-tenant in practice (Fisher), but every row hangs off a user_id so
-- multi-tenant is a later config change, not a migration.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE,   -- OIDC subject
    email      TEXT NOT NULL DEFAULT '',
    name       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A feed is a theme/collection the user consumes ("Comedy", "Local News",
-- "Music"). It is a saved grouping of sources, not a folder - the session
-- builder targets one or more feeds.
CREATE TABLE IF NOT EXISTS feeds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '',
    -- flat identity glyph key (see web/src/lib/feedIcons.ts); '' = unset,
    -- render the color swatch instead. Added additively via migrate() for
    -- databases created before this column existed.
    icon        TEXT NOT NULL DEFAULT '',
    -- per-feed ranker overrides (#17). Added additively via migrate() for
    -- databases created before these columns existed.
    -- freshness half-life for this feed's items, in days; 0 = use the global
    -- default (session.freshnessHalfLifeDays).
    half_life_days REAL NOT NULL DEFAULT 0,
    -- per-session per-source cap for this feed's sources: 0 = use each source's
    -- own per_session_cap; N >= 1 caps every source in this feed to N items per
    -- session (lower N = more sources spread across the session).
    diversity   INTEGER NOT NULL DEFAULT 0,
    sort        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, slug)
);

-- A source is a creator/channel the user follows: an RSS feed, a YouTube
-- channel (via its RSS), a podcast. Weight and cadence_cap are the two knobs
-- that make consumption deterministic and controllable.
CREATE TABLE IF NOT EXISTS sources (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL DEFAULT 'rss',       -- rss | youtube | podcast
    title         TEXT NOT NULL,
    feed_url      TEXT NOT NULL,
    homepage_url  TEXT NOT NULL DEFAULT '',
    icon_url      TEXT NOT NULL DEFAULT '',
    -- weight buckets map to multipliers in code: very_low .25, low .5,
    -- normal 1, high 2, favorite 5.
    weight        REAL NOT NULL DEFAULT 1.0,
    -- state machine: suggested -> trial -> followed -> archived.
    state         TEXT NOT NULL DEFAULT 'followed',
    trial_until   TEXT,                              -- when a trial auto-review is due
    -- hard cap on how many items from this source a single session may include.
    -- The point: a 30-a-day source never floods a session; the once-a-week
    -- source is never crowded out.
    per_session_cap INTEGER NOT NULL DEFAULT 2,
    added_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_fetch_at TEXT,
    fetch_error   TEXT NOT NULL DEFAULT '',
    UNIQUE (user_id, feed_url)
);

CREATE TABLE IF NOT EXISTS feed_sources (
    feed_id   INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    PRIMARY KEY (feed_id, source_id)
);

-- A normalized content event from a source.
CREATE TABLE IF NOT EXISTS items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    external_id   TEXT NOT NULL,                     -- guid / link, dedup key
    url           TEXT NOT NULL,
    title         TEXT NOT NULL,
    summary       TEXT NOT NULL DEFAULT '',
    author        TEXT NOT NULL DEFAULT '',
    thumbnail_url TEXT NOT NULL DEFAULT '',
    -- short | long | article | audio | live | unknown
    media_type    TEXT NOT NULL DEFAULT 'unknown',
    duration_sec  INTEGER NOT NULL DEFAULT 0,        -- 0 = unknown, estimated at rank time
    published_at  TEXT NOT NULL,
    fetched_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_items_source_pub ON items(source_id, published_at DESC);

-- Per-user interaction state for an item. The absence of a row means "unseen".
CREATE TABLE IF NOT EXISTS item_state (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    -- surfaced | opened | liked | skipped | saved | dismissed
    state       TEXT NOT NULL,
    surfaced_at TEXT,
    acted_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, item_id)
);

-- Built sessions - one row per "give me 20 minutes of comedy" request.
CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,                     -- random token
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    min_low    INTEGER NOT NULL,                     -- requested range, minutes
    min_high   INTEGER NOT NULL,
    themes     TEXT NOT NULL DEFAULT '',             -- csv of feed slugs, '' = all
    item_ids   TEXT NOT NULL DEFAULT '',             -- csv of selected item ids, in order
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only event log - the raw material for user-owned stats and the
-- JSON/agent surface. Never mutated.
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,                        -- session_build | surface | open | like | skip | ...
    item_id    INTEGER,
    source_id  INTEGER,
    session_id TEXT,
    detail     TEXT NOT NULL DEFAULT '',             -- json blob
    at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_user_at ON events(user_id, at DESC);
