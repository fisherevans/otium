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

-- An interest is a theme/collection the user consumes ("Comedy", "Local News",
-- "Music"). It is a saved grouping of sources, not a folder - the session
-- builder targets one or more interests. (Renamed from `feeds`, #111.)
CREATE TABLE IF NOT EXISTS interests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '',
    -- flat identity glyph key (see web/src/lib/feedIcons.ts); '' = unset,
    -- render the color swatch instead. Added additively via migrate() for
    -- databases created before this column existed.
    icon        TEXT NOT NULL DEFAULT '',
    -- per-interest ranker overrides (#17). Added additively via migrate() for
    -- databases created before these columns existed.
    -- freshness half-life for this interest's items, in days; 0 = use the global
    -- default (session.freshnessHalfLifeDays).
    half_life_days REAL NOT NULL DEFAULT 0,
    -- per-session per-source cap for this interest's sources: 0 = use each source's
    -- own per_session_cap; N >= 1 caps every source in this interest to N items per
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
    -- The one interest this source belongs to (#86). A source belongs to exactly
    -- one interest (or none - NULL - for an interestless source that renders
    -- source-only). This replaced the source<->interest many-to-many (feed_sources,
    -- kept legacy below). Nullable so an interestless source is representable; the
    -- UI's picker requires one. Added additively via migrate() and back-populated
    -- from feed_sources. (Renamed from feed_id, #111.)
    interest_id   INTEGER REFERENCES interests(id) ON DELETE SET NULL,
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
    -- per-source freshness half-life override (#76), in days; 0 = inherit. The
    -- resolution hierarchy is source override > feed (resolved) > global default
    -- (session.freshnessHalfLifeDays). Added additively via migrate() for
    -- databases created before this column existed.
    half_life_days REAL NOT NULL DEFAULT 0,
    added_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_fetch_at TEXT,
    fetch_error   TEXT NOT NULL DEFAULT '',
    UNIQUE (user_id, feed_url)
);
-- NOTE: the idx_sources_interest index is created in migrate() (store.go), NOT
-- here. A pre-existing `sources` table (from before interest_id) is skipped by
-- CREATE TABLE IF NOT EXISTS, so interest_id doesn't exist until migrate()'s
-- ensureColumn adds it - an index on interest_id here would fail on apply against
-- a legacy DB. Same reason as the sessions status index below.

-- LEGACY (pre-#86): the source<->interest many-to-many. Superseded by
-- sources.interest_id (a source now belongs to exactly one interest). Left in
-- place, unused by the app, as a rollback safety net - migrate() reads it once to
-- populate sources.interest_id and never writes it again. Its column keeps the
-- historical name feed_id (#111 renamed the concept but froze this legacy table).
-- Do NOT drop it; do NOT read it in new code.
CREATE TABLE IF NOT EXISTS feed_sources (
    feed_id   INTEGER NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    PRIMARY KEY (feed_id, source_id)
);

-- A mix is a user-created overlay that gathers several INTERESTS under one name
-- ("News" = Local + International). Many-to-many: an interest can be in several
-- mixes (#86). Distinct from an interest (which groups sources) and a collection
-- (which groups items). Mixes are purely organizational - the session builder can
-- target a mix by expanding it to its member interests. (Renamed from `groups`, #111.)
CREATE TABLE IF NOT EXISTS mixes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL,
    -- flat identity glyph key (see web/src/lib/feedIcons.ts); '' = unset.
    icon       TEXT NOT NULL DEFAULT '',
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, slug)
);

-- Membership: which interests belong to a mix. The UNIQUE (mix_id, interest_id) PK
-- makes re-adding an interest an idempotent no-op. (Renamed from `group_feeds`, #111.)
CREATE TABLE IF NOT EXISTS mix_interests (
    mix_id      INTEGER NOT NULL REFERENCES mixes(id) ON DELETE CASCADE,
    interest_id INTEGER NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
    PRIMARY KEY (mix_id, interest_id)
);

-- A normalized content event from a source.
CREATE TABLE IF NOT EXISTS items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    external_id   TEXT NOT NULL,                     -- guid / link, dedup key
    url           TEXT NOT NULL,
    title         TEXT NOT NULL,
    -- short plain-text preview for the CARD (stripped + clipped at ingest).
    summary       TEXT NOT NULL DEFAULT '',
    -- full article body as raw (unsanitized) HTML, preferring content:encoded
    -- then description. Rendered in the reader through a client-side DOMPurify
    -- sanitizer. Empty for items ingested before this column existed - upsert is
    -- insert-only, so old rows stay empty until they age out; new items get it.
    -- Added additively via migrate() for databases created before this column.
    content       TEXT NOT NULL DEFAULT '',
    -- provenance of the reader body (#98): '' / pending = not yet attempted,
    -- 'rss' = the feed shipped the body, 'fetched' = the backend readability-
    -- extracted it from the article URL on demand, 'external' = not extractable
    -- (video/paywall/JS-only) so the client offers "open original" instead. The
    -- on-demand /items/{id}/content endpoint owns the pending -> fetched|external
    -- transition; once it leaves '' we never re-fetch (persisted cache). Added
    -- additively via migrate() with a one-time 'rss' backfill for existing bodies.
    content_source TEXT NOT NULL DEFAULT '',
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

-- Built sessions - one row per "give me 20 minutes of comedy" request. A session
-- is durable: the built queue (item_ids) and the read position (cursor) live
-- here, so a refresh or a return resumes the SAME items at the SAME place rather
-- than rebuilding a fresh feed (#67). One session per user is 'active' at a time;
-- starting a new one ends the previous. When it's over (time budget reached or
-- the queue is exhausted) it flips to 'ended' and the client returns home.
CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,                     -- random token
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- min_low/min_high predate the single-duration model (#69); both now equal
    -- duration_min. Kept for back-compat with rows written before duration_min.
    min_low      INTEGER NOT NULL,
    min_high     INTEGER NOT NULL,
    -- the single chosen session length, minutes (#69). Added additively via
    -- migrate() for databases created before this column existed.
    duration_min INTEGER NOT NULL DEFAULT 0,
    themes       TEXT NOT NULL DEFAULT '',             -- csv of feed slugs, '' = all
    item_ids     TEXT NOT NULL DEFAULT '',             -- csv of selected item ids, in order (the built queue)
    -- read position into item_ids: how far the user has advanced. Persisted as
    -- they scroll so a resume lands on the same item. Added additively.
    cursor       INTEGER NOT NULL DEFAULT 0,
    -- 'active' | 'ended'. Exactly one 'active' row per user. Added additively.
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
-- NOTE: the idx_sessions_user_status index is created in migrate() (store.go),
-- NOT here. A pre-existing `sessions` table (from before status/cursor/duration_min)
-- is skipped by CREATE TABLE IF NOT EXISTS, so `status` doesn't exist until
-- migrate()'s ensureColumn adds it - an index on status here would fail on apply.

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

-- Per-user key/value flags for one-time migrations and settings markers. Used
-- to gate idempotent backfills that must run exactly once and then never fight a
-- later manual change (e.g. the Videos-feed backfill, key 'videos_backfill_done').
CREATE TABLE IF NOT EXISTS kv (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, key)
);

-- A named list of saved items (#57). Distinct from feeds: feeds group SOURCES
-- for session-building; collections group ITEMS the user deliberately set aside.
-- Three builtins are seeded per user (Saved, Watch Later, Liked); the rest are
-- user-created. `kind` gates which are renamable/deletable. There are no
-- per-item tags - this is a handful of named sets, not a taxonomy.
CREATE TABLE IF NOT EXISTS collections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL,
    -- builtin (Saved / Watch Later / Liked, seeded, protected) | user
    kind       TEXT NOT NULL DEFAULT 'user',
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, slug)
);

-- Membership: which items belong to a collection. Newest-added first when
-- browsed. The UNIQUE (collection_id, item_id) is the PK, so re-adding an item
-- is an idempotent no-op.
CREATE TABLE IF NOT EXISTS collection_items (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    added_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_items_item ON collection_items(item_id);
