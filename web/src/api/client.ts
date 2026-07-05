// Typed client for the otium API. The SPA always calls relative /api/v1 paths;
// dev proxies to the Go server, prod nginx does. On 401/403 we bounce to the
// server-driven OIDC login (there is no login form in the SPA).

export interface Me {
  id: number;
  username: string;
  email: string;
  name: string;
}

export interface Feed {
  id: number;
  name: string;
  slug: string;
  color: string;
  icon: string; // flat glyph key (see lib/feedIcons); "" = unset
  half_life_days: number; // per-feed freshness half-life in days; 0 = global default (#17)
  diversity: number; // per-session per-source cap for this feed's sources; 0 = use source cap (#17)
  sort: number;
  source_count?: number;
}

// Compact feed identity attached to a session item (#44). Null/absent when the
// item's source belongs to no feed (e.g. a YouTube channel) - the card then
// renders source-only.
export interface FeedRef {
  name: string;
  slug: string;
  color: string;
  icon: string;
}

export interface Source {
  id: number;
  kind: string;
  title: string;
  feed_url: string;
  homepage_url: string;
  icon_url: string;
  weight: number;
  state: string;
  per_session_cap: number;
  half_life_days: number; // per-source freshness half-life override; 0 = inherit feed/global (#76)
  added_at: string;
  last_fetch_at?: string;
  fetch_error?: string;
  // The one feed this source belongs to (#86). feed_id is null/absent when
  // feedless; feed_slug is the denormalized slug for the UI ("" when feedless).
  feed_id?: number | null;
  feed_slug?: string;
  item_count?: number;
  unseen_count?: number;
  skip_pct?: number;
  posts_per_day?: number;
}

export interface Item {
  id: number;
  source_id: number;
  url: string;
  title: string;
  summary: string; // short plain-text card preview
  content: string; // full body, raw HTML; sanitized client-side before render (#58)
  author: string;
  thumbnail_url: string;
  media_type: string;
  duration_sec: number;
  published_at: string;
  fetched_at: string;
}

// --- #83 personal-history block ---
// One history filter: the slice of item_state to browse. "shown" = everything
// surfaced in a session; "read" = engaged (opened/liked/saved); then liked/saved.
export type HistoryFilter = "shown" | "read" | "liked" | "saved";

// HistoryItem is an Item plus the user's interaction on it (#83). state is the
// current item_state.state; interacted_at is when the interaction that put it in
// this filter happened (surface time for "shown", act time otherwise).
export interface HistoryItem extends Item {
  state: string; // surfaced | opened | liked | skipped | saved | dismissed
  interacted_at: string;
}
// --- end #83 block ---

// ScoreBreakdown decomposes an item's effective score into the exact factors the
// ranker used (#18). The four multipliers multiply to effective_score, which is
// the real ranker output (matches ItemEffectiveScore server-side) - never an
// approximation. cadence_per_day / skip_pct / age_days are the raw inputs behind
// the factors, for the plain-language lines.
export interface ScoreBreakdown {
  weight: number; // source weight multiplier (0.25..5, default 1)
  rarity: number; // rarity boost for infrequent sources (1 = not rare)
  freshness: number; // age decay (1 = brand new → 0 as it ages)
  skip_penalty: number; // behavior downweight (1 = never skipped, down to 0.5)
  effective_score: number; // weight × rarity × freshness × skip_penalty
  cadence_per_day: number; // source posts/day over the window
  skip_pct: number; // 0..1 raw skip rate
  age_days: number; // item age in days at build time
}

export interface Selected {
  item: Item;
  source_title: string;
  feed?: FeedRef | null; // primary feed identity; absent for a feedless source
  score: number;
  est_duration_sec: number;
  reason: string;
  breakdown: ScoreBreakdown;
}

export interface SessionResult {
  items: Selected[];
  total_seconds: number;
  target_low_min: number;
  target_high_min: number;
  pool_size: number;
}

export interface BuildResponse {
  session_id: string;
  result: SessionResult;
}

// --- durable sessions (#67 + #69) ---
// A session is a stored queue + a read cursor built from a single duration.
// createSession returns it; currentSession resumes the active one (undefined =
// none); updateSession advances the cursor / ends it. session_id is "" when the
// selection had nothing to build (client stays home).
export interface SessionResponse {
  session_id: string;
  duration_min: number;
  cursor: number;
  themes: string[];
  items: Selected[];
}

export interface ImportCandidate {
  title: string;
  feed_url: string;
  homepage_url: string;
  kind: string;
  category: string;
}

export interface ParseResult {
  format: string;
  count: number;
  candidates: ImportCandidate[];
}

export interface CommitResult {
  created: number;
  already_had: number;
  feeds_created: number;
  refreshing: boolean;
}

// Feed "mix" view (#49). Per source: its live effective share of the feed
// (current freshness-decayed ranker score incl. skip penalty, normalized) paired
// with intended_share (same, minus the skip penalty) and skip_pct. A big
// intended slice you mostly skip is the inefficiency signal.
export interface MixSource {
  source_id: number;
  source_title: string;
  feed: FeedRef | null; // primary feed; null for a feedless source
  effective_share: number; // 0..1, sums to 1 across sources
  intended_share: number; // 0..1, "wants to be" (no skip penalty)
  skip_pct: number; // 0..1
  item_count: number;
  weight: number; // current multiplier (map via bucketOf for the control)
}

export interface MixFeed {
  feed: FeedRef | null; // null = feedless bucket
  effective_share: number;
  intended_share: number;
  source_count: number;
  item_count: number;
}

export interface MixResponse {
  scope: "all" | "feed";
  feed?: string; // slug, when scope === "feed"
  sources: MixSource[];
  feeds: MixFeed[];
  totals: { source_count: number; item_count: number };
}

// A named list of saved items (#57). Builtins (Saved / Watch Later / Liked) are
// seeded per user and can't be renamed/deleted (kind === "builtin"). `contains`
// is present only when the list was fetched for a specific item (the Save
// picker's membership checkmark).
export interface Collection {
  id: number;
  name: string;
  slug: string;
  kind: "builtin" | "user";
  sort: number;
  created_at: string;
  item_count: number;
  contains?: boolean;
}

// The Liked collection is driven exclusively by the Like button, so the Save
// picker hides it - saving is the deliberate path, liking is the one-tap path.
export const LIKED_SLUG = "liked";

// A group (#86): a user-created overlay gathering several feeds (many-to-many).
// feed_count is the denormalized membership size.
export interface Group {
  id: number;
  name: string;
  slug: string;
  icon: string; // flat glyph key (see lib/feedIcons); "" = unset
  sort: number;
  created_at: string;
  feed_count: number;
}

// GroupBrowse is GET /groups/{id}: the group's member feeds and the sources
// aggregated across them (Group -> Feed -> Source).
export interface GroupBrowse {
  feeds: Feed[];
  sources: Source[];
}

// User settings (#68). fast_scroll_checkin gates the dwell/engagement
// measurement + the fast-scroll check-in nudge. Off = the old explicit-only
// behavior: no dwell measured, no nudge. (The #76 multi-feed half-life rule was
// removed in #86 - a source now has exactly one feed, so there's nothing to pick.)
export interface Settings {
  fast_scroll_checkin: boolean;
}

// Appearance preferences (#80/#81/#82). Display-only: reader typography, card
// styling, and the intent-page session-length presets. Never read by the ranker.
// The server fills defaults for a fresh user, so this is always fully populated.
export interface ReaderPrefs {
  font_size: number; // px
  line_height: number; // unitless
  measure: number; // max line length, ch
  images: boolean; // render images inside the reader body
}
export interface CardPrefs {
  meta_size: number; // sub-text / media-type meta, px
  source_size: number; // source label, px
  feed_tag_size: number; // feed identity tag, px
  date_size: number; // date above the hero (#73), px
  hero_show: boolean; // show the hero/media block
  hero_color: boolean; // true = color; false = grayscale/dither
}
export interface Preferences {
  reader: ReaderPrefs;
  card: CardPrefs;
  presets: number[]; // intent-page chips, minutes
}

// A deep-partial patch for PUT /preferences: the server merges it onto the
// stored blob, so a change need only carry the fields it touches.
export type PreferencesPatch = {
  reader?: Partial<ReaderPrefs>;
  card?: Partial<CardPrefs>;
  presets?: number[];
};

export class Unauthorized extends Error {}

function handleAuth(status: number) {
  if (status === 401 || status === 403) {
    if (!location.pathname.startsWith("/auth/")) {
      const rd = encodeURIComponent(location.pathname + location.search);
      location.assign(`/auth/login?rd=${rd}`);
    }
    throw new Unauthorized("unauthenticated");
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) {
    if (!location.pathname.startsWith("/auth/")) {
      const rd = encodeURIComponent(location.pathname + location.search);
      location.assign(`/auth/login?rd=${rd}`);
    }
    throw new Unauthorized("unauthenticated");
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      msg = j.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: () => req<Me>("GET", "/users/me"),

  feeds: () => req<Feed[]>("GET", "/feeds"),
  createFeed: (name: string, color?: string) =>
    req<Feed>("POST", "/feeds", { name, color: color ?? "" }),
  updateFeed: (
    id: number,
    patch: { name?: string; color?: string; icon?: string; half_life_days?: number; diversity?: number },
  ) => req<{ ok: boolean }>("PATCH", `/feeds/${id}`, patch),
  setFeedSources: (feedId: number, sourceIds: number[]) =>
    req<{ ok: boolean }>("PUT", `/feeds/${feedId}/sources`, { source_ids: sourceIds }),

  // Groups (#86): a user-created overlay grouping feeds (many-to-many). CRUD +
  // feed-assignment + a browse endpoint (its feeds + aggregated sources).
  groups: () => req<Group[]>("GET", "/groups"),
  createGroup: (name: string, icon?: string) =>
    req<Group>("POST", "/groups", { name, icon: icon ?? "" }),
  updateGroup: (id: number, patch: { name?: string; icon?: string }) =>
    req<{ ok: boolean }>("PATCH", `/groups/${id}`, patch),
  deleteGroup: (id: number) => req<{ ok: boolean }>("DELETE", `/groups/${id}`),
  setGroupFeeds: (id: number, feedIds: number[]) =>
    req<{ ok: boolean }>("PUT", `/groups/${id}/feeds`, { feed_ids: feedIds }),
  groupBrowse: (id: number) => req<GroupBrowse>("GET", `/groups/${id}`),

  sources: () => req<Source[]>("GET", "/sources"),
  createSource: (s: { title: string; feed_url: string; kind?: string; weight?: number }) =>
    req<Source>("POST", "/sources", s),
  updateSource: (
    id: number,
    patch: { weight_bucket?: string; state?: string; per_session_cap?: number; half_life_days?: number; title?: string },
  ) => req<{ ok: boolean }>("PATCH", `/sources/${id}`, patch),
  deleteSource: (id: number) => req<{ ok: boolean }>("DELETE", `/sources/${id}`),
  // Set the source's one feed (#86). Empty slug clears it (feedless).
  setSourceFeed: (id: number, feedSlug: string) =>
    req<{ ok: boolean }>("PUT", `/sources/${id}/feed`, { feed_slug: feedSlug }),
  sourceItems: (id: number) => req<Item[]>("GET", `/sources/${id}/items`),
  // --- #66 feed-mgmt-pages block (feed page recent posts) ---
  feedItems: (feedId: number) => req<Item[]>("GET", `/feeds/${feedId}/items`),
  // --- end #66 block ---

  mix: (feedSlug?: string) =>
    req<MixResponse>("GET", `/mix${feedSlug ? `?feed=${encodeURIComponent(feedSlug)}` : ""}`),

  // Durable sessions (#67 + #69). createSession builds + stores the queue for a
  // single duration; currentSession resumes the active one (204 -> undefined);
  // updateSession advances the cursor or ends it.
  createSession: (durationMin: number, themes: string[]) =>
    req<SessionResponse>("POST", "/sessions", { duration_min: durationMin, themes }),
  currentSession: () => req<SessionResponse | undefined>("GET", "/sessions/current"),
  updateSession: (id: string, patch: { cursor?: number; status?: "ended" }) =>
    req<{ ok: boolean }>("PATCH", `/sessions/${id}`, patch),
  itemEvent: (id: number, type: string, sessionId?: string) =>
    req<{ ok: boolean }>("POST", `/items/${id}/event`, { type, session_id: sessionId ?? "" }),
  // Per-item dwell (#68): how long the item was engaged + whether it was engaged
  // at all, on advance. Append-only raw material - never re-ranks. Only sent when
  // the fast-scroll check-in setting is on.
  recordDwell: (id: number, sessionId: string, dwellMs: number, engaged: boolean) =>
    req<{ ok: boolean }>("POST", `/items/${id}/dwell`, { session_id: sessionId, dwell_ms: dwellMs, engaged }),
  fetchNow: () => req<{ new_items: number }>("POST", "/fetch"),

  // --- #83 personal-history block ---
  // Personal history (#83): items shown vs engaged, newest-interaction-first,
  // each with its interaction state + timestamp. Read-only; never touches the
  // ranker. limit/offset drive "load more".
  history: (filter: HistoryFilter, limit = 50, offset = 0) =>
    req<HistoryItem[]>("GET", `/history?filter=${filter}&limit=${limit}&offset=${offset}`),
  // --- end #83 block ---

  // Settings (#68): the fast-scroll check-in toggle. updateSettings returns the
  // full current settings.
  getSettings: () => req<Settings>("GET", "/settings"),
  updateSettings: (patch: Partial<Settings>) => req<Settings>("PATCH", "/settings", patch),

  // Appearance preferences (#80/#81/#82): display-only reader/card/preset styling.
  // updatePreferences merges the patch server-side and returns the full result.
  getPreferences: () => req<Preferences>("GET", "/preferences"),
  updatePreferences: (patch: PreferencesPatch) => req<Preferences>("PUT", "/preferences", patch),

  // Collections (#57). Pass an itemId to get per-collection membership flags for
  // the Save picker; omit it for the plain list-with-counts.
  collections: (itemId?: number) =>
    req<Collection[]>("GET", `/collections${itemId ? `?item_id=${itemId}` : ""}`),
  createCollection: (name: string) => req<Collection>("POST", "/collections", { name }),
  renameCollection: (id: number, name: string) =>
    req<{ ok: boolean }>("PATCH", `/collections/${id}`, { name }),
  deleteCollection: (id: number) => req<{ ok: boolean }>("DELETE", `/collections/${id}`),
  collectionItems: (id: number) => req<Item[]>("GET", `/collections/${id}/items`),
  addToCollection: (id: number, itemId: number) =>
    req<{ ok: boolean }>("POST", `/collections/${id}/items`, { item_id: itemId }),
  removeFromCollection: (id: number, itemId: number) =>
    req<{ ok: boolean }>("DELETE", `/collections/${id}/items/${itemId}`),

  // Import: parse sends the raw upload (text OR a file Blob - a zip must go as
  // bytes, not text) so the server can unzip / parse it directly.
  parseImport: async (body: string | Blob): Promise<ParseResult> => {
    const res = await fetch("/api/v1/import/parse", {
      method: "POST",
      headers: { "Content-Type": typeof body === "string" ? "text/plain" : "application/octet-stream" },
      body,
    });
    handleAuth(res.status);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `${res.status}`);
    return res.json();
  },
  commitImport: (sources: ImportCandidate[], createFeedsFromFolders: boolean) =>
    req<CommitResult>("POST", "/import/commit", {
      sources,
      create_feeds_from_folders: createFeedsFromFolders,
    }),
};
