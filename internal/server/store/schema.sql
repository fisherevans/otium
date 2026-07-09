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

-- An topic is a theme/collection the user consumes ("Comedy", "Local News",
-- "Music"). It is a saved grouping of sources, not a folder - the session
-- builder targets one or more topics. (Renamed from `feeds`, #111.)
CREATE TABLE IF NOT EXISTS topics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '',
    -- flat identity glyph key (see web/src/lib/feedIcons.ts); '' = unset,
    -- render the color swatch instead. Added additively via migrate() for
    -- databases created before this column existed.
    icon        TEXT NOT NULL DEFAULT '',
    -- per-topic ranker overrides (#17). Added additively via migrate() for
    -- databases created before these columns existed.
    -- freshness half-life for this topic's items, in days; 0 = use the global
    -- default (session.freshnessHalfLifeDays).
    half_life_days REAL NOT NULL DEFAULT 0,
    -- Archive After (session engine v2, #115): the default expiration window in
    -- days for this topic's sources. 0 = use the global default; -1 = evergreen
    -- (never archive); N = archive articles older than N days. A source's own
    -- archive_after_days overrides this. Replaces user-facing half-life.
    archive_after_days INTEGER NOT NULL DEFAULT 0,
    -- The one section this topic belongs to (#130, strict Section>Topic>Source
    -- tree). A topic belongs to exactly one section; orphans are routed to an
    -- auto-created "Uncategorized" section by enforceTree(). Nullable in the DB
    -- (SQLite can't add NOT NULL retroactively) but app-enforced: read paths treat
    -- a NULL section_id as Uncategorized. Added additively via migrate().
    section_id  INTEGER REFERENCES sections(id) ON DELETE SET NULL,
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
    -- The one topic this source belongs to (#86). A source belongs to exactly
    -- one topic (or none - NULL - for an topicless source that renders
    -- source-only). This replaced the source<->topic many-to-many (feed_sources,
    -- kept legacy below). Nullable so an topicless source is representable; the
    -- UI's picker requires one. Added additively via migrate() and back-populated
    -- from feed_sources. (Renamed from feed_id, #111.)
    topic_id   INTEGER REFERENCES topics(id) ON DELETE SET NULL,
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
    -- Archive After (session engine v2, #115): expiration window in days. 0 =
    -- inherit the topic default; -1 = evergreen (never archive); N = archive
    -- articles older than N days. Source override > topic default > global.
    archive_after_days INTEGER NOT NULL DEFAULT 0,
    -- Auto-archive keywords (#118): comma-separated, case-insensitive. An item
    -- whose title or summary contains any of these is ineligible (auto-archived).
    archive_keywords TEXT NOT NULL DEFAULT '',
    -- Rule-based auto-archive (#124), per-source only (topics/global stay
    -- age-only). archive_keep_count is the keep-latest-N rule: 0 = off, N = keep
    -- only the newest N eligible items (a rolling window that refills from the
    -- backlog as items are consumed). archive_combine is how the age and count
    -- rules combine when BOTH are active: 'and' (older-than-X AND beyond-newest-N)
    -- or 'or'. Defaults reproduce today's age-only behavior.
    archive_keep_count INTEGER NOT NULL DEFAULT 0,
    archive_combine    TEXT NOT NULL DEFAULT 'and',
    -- Per-source article scoring config (#124), JSON: {direction, length}. '' =
    -- default (newest, no facets), byte-identical to today's pure-recency order.
    scoring_config TEXT NOT NULL DEFAULT '',
    added_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_fetch_at TEXT,
    fetch_error   TEXT NOT NULL DEFAULT '',
    UNIQUE (user_id, feed_url)
);
-- NOTE: the idx_sources_topic index is created in migrate() (store.go), NOT
-- here. A pre-existing `sources` table (from before topic_id) is skipped by
-- CREATE TABLE IF NOT EXISTS, so topic_id doesn't exist until migrate()'s
-- ensureColumn adds it - an index on topic_id here would fail on apply against
-- a legacy DB. Same reason as the sessions status index below.

-- LEGACY (pre-#86): the source<->topic many-to-many. Superseded by
-- sources.topic_id (a source now belongs to exactly one topic). Left in
-- place, unused by the app, as a rollback safety net - migrate() reads it once to
-- populate sources.topic_id and never writes it again. Its column keeps the
-- historical name feed_id (#111 renamed the concept but froze this legacy table).
-- Do NOT drop it; do NOT read it in new code.
CREATE TABLE IF NOT EXISTS feed_sources (
    feed_id   INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    PRIMARY KEY (feed_id, source_id)
);

-- A section is a user-created overlay that gathers several TOPICS under one name
-- ("News" = Local + International). Many-to-many: an topic can be in several
-- sections (#86). Distinct from an topic (which groups sources) and a collection
-- (which groups items). Sections are purely organizational - the session builder can
-- target a section by expanding it to its member topics. (Renamed from `groups`, #111.)
CREATE TABLE IF NOT EXISTS sections (
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

-- Membership: which topics belong to a section. The UNIQUE (section_id, topic_id) PK
-- makes re-adding an topic an idempotent no-op. (Renamed from `group_feeds`, #111.)
CREATE TABLE IF NOT EXISTS section_topics (
    section_id      INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    PRIMARY KEY (section_id, topic_id)
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

-- Durable per-item metadata enrichment queue (#120). One row per (item, enricher
-- kind), e.g. ('youtube_metadata'). The background worker fetches out-of-band
-- metadata (video duration today; article engagement/other facets later) and is
-- generic - kind names the pluggable enricher. status: pending (needs work /
-- retry scheduled) | done | failed (gave up after max attempts = "not available").
-- Durable across restarts: the worker resumes from whatever is still pending, and
-- backoff lives in next_attempt_at so rate-limits / outages self-heal.
CREATE TABLE IF NOT EXISTS item_enrichment (
    item_id         INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_error      TEXT NOT NULL DEFAULT '',
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (item_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_item_enrichment_due ON item_enrichment(status, next_attempt_at);

-- Durable per-source backlog import (#122). One row per YouTube source being
-- backfilled from the Data API. page_token resumes pagination across restarts;
-- import depth is bounded to the source's resolved Archive-After window (older
-- videos would never be eligible), computed fresh each run so a re-sync after
-- widening the window fetches more. status: pending (queued) | done | failed.
CREATE TABLE IF NOT EXISTS source_import (
    source_id       INTEGER PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending',
    page_token      TEXT NOT NULL DEFAULT '',
    imported        INTEGER NOT NULL DEFAULT 0,
    -- videos walked so far (#124), so the keep-latest-N count bound is over the
    -- source's absolute newest-first position, not reset each page.
    seen            INTEGER NOT NULL DEFAULT 0,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_error      TEXT NOT NULL DEFAULT '',
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Small global (non-user) key/value store for system cursors, e.g. the enrichment
-- backfill sweep position. (The other kv table is user-scoped; this is not.)
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
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
