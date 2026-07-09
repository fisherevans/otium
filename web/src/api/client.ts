// Typed client for the otium API. The SPA always calls relative /api/v1 paths;
// dev proxies to the Go server, prod nginx does. On 401/403 we bounce to the
// server-driven OIDC login (there is no login form in the SPA).

export interface Me {
  id: number;
  username: string;
  email: string;
  name: string;
}

export interface Interest {
  id: number;
  name: string;
  slug: string;
  color: string;
  icon: string; // flat glyph key (see lib/feedIcons); "" = unset
  half_life_days: number; // per-interest freshness half-life in days; 0 = global default (#17)
  // Default archival window for this interest's sources (#115): 0 = inherit the
  // global default, -1 = evergreen (never archive), N = archive items older than N
  // days. Not returned by the list endpoint yet, so treat absent as 0 (inherit).
  archive_after_days?: number;
  sort: number;
  source_count?: number;
}

// Compact interest identity attached to a session item (#44). Null/absent when the
// item's source belongs to no interest (e.g. a YouTube channel) - the card then
// renders source-only.
export interface InterestRef {
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
  half_life_days: number; // per-source freshness half-life override; 0 = inherit interest/global (#76)
  added_at: string;
  last_fetch_at?: string;
  fetch_error?: string;
  // The one interest this source belongs to (#86). interest_id is null/absent when
  // interestless; interest_slug is the denormalized slug for the UI ("" when interestless).
  interest_id?: number | null;
  interest_slug?: string;
  item_count?: number;
  unseen_count?: number;
  skip_pct?: number;
  posts_per_day?: number;
  // Archive After (#115): 0 = inherit the interest/global default, -1 = evergreen,
  // N = archive items older than N days. Auto-archive keywords (#118) is a
  // comma-separated string ("a, b, c"). Neither is returned by the list endpoint
  // yet, so treat absent archive_after_days as 0 (inherit) and keywords as "".
  archive_after_days?: number;
  archive_keywords?: string;
}

// Per-source transparency bundle (#116): supply, publishing rate, and the
// engagement lifecycle for one source. GET /sources/stats returns these keyed by
// source id. shown = presented at least once; invisible == unseen (never
// presented); on_deck = unseen and still within the archive window; per_day is the
// publishing rate over the observed span. skip_pct / open_pct are 0..1 over shown.
export interface SourceStats {
  source_id: number;
  total: number;
  unseen: number;
  on_deck: number;
  shown: number;
  skipped: number;
  opened: number;
  liked: number;
  per_day: number;
  invisible: number;
  skip_pct: number;
  open_pct: number;
  // Time-based invisibility (#120): counts only items published since the source
  // was added, so the import backfill doesn't read as ~100% invisible. shown_since
  // = presented; missed_since = aged out unseen; invisible_pct = missed / (shown +
  // missed). This is the honest "am I ever actually seeing this source" signal.
  shown_since: number;
  missed_since: number;
  invisible_pct: number;
  // Rolling 30-day engagement window (#120): absolute counts need a time range.
  // shown_30 = presented (any state) in the last 30 days; the UI splits it into
  // opened / skipped / (remainder = pending) so the three sum to the whole.
  shown_30: number;
  opened_30: number;
  skipped_30: number;
}

export interface Item {
  id: number;
  source_id: number;
  url: string;
  title: string;
  summary: string; // short plain-text card preview
  content: string; // full body, raw HTML; sanitized client-side before render (#58)
  // provenance of the reader body (#98): "" (pending) | rss | fetched | external.
  // #96 renders content-aware actions off this (read in-app vs open original vs watch).
  content_source: string;
  author: string;
  thumbnail_url: string;
  media_type: string;
  duration_sec: number;
  published_at: string;
  fetched_at: string;
}

// SourceItem is an item plus the user's current engagement state on it (#120):
// "" = unseen; else surfaced | opened | liked | skipped | saved | dismissed. The
// source's article surfaces derive the displayed status (unread / presented / read
// / skipped / auto-archived) from this + eligibility.
export interface SourceItem extends Item {
  state: string;
}

// On-demand full-text (#98/#99): the /items/{id}/content response. content is the
// best reader body ("" when external); content_source is the resolved provenance
// (rss | fetched | external). `render` is the explicit engagement state #96
// branches on so it never has to combine content_source + media_type itself:
//   - "full_text": in-app reader body exists (rss|fetched).
//   - "preview":   no full text, but a teaser/summary to show while linking out.
//   - "external":  no full text, nothing to preview - open original / watch.
// has_full_text is kept for back-compat and equals render === "full_text".
export type ItemRender = "full_text" | "preview" | "external";
export interface ItemContent {
  content_source: string;
  content: string;
  has_full_text: boolean;
  render: ItemRender;
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
// ranker used (#18). The three multipliers multiply to effective_score, which is
// the real ranker output (matches ItemEffectiveScore server-side) - never an
// approximation. cadence_per_day / age_days are the raw inputs behind the factors,
// for the plain-language lines. No skip factor: skipping drives an explicit
// recommendation (#19), never a silent score cut (#109).
export interface ScoreBreakdown {
  weight: number; // source weight multiplier (0.25..5, default 1)
  rarity: number; // relative-rarity boost (1 = as common as your interest gets, up to 2 for the rarest)
  freshness: number; // age decay (1 = brand new → 0 as it ages)
  effective_score: number; // weight × rarity × freshness
  cadence_per_day: number; // source posts/day over the window (its rank among your sources drives rarity)
  age_days: number; // item age in days at build time
}

export interface Selected {
  item: Item;
  source_title: string;
  interest?: InterestRef | null; // primary interest identity; absent for a interestless source
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
  interests_created: number;
  refreshing: boolean;
}

// Interest "insights" view (#49). Per source: its live effective share of the interest
// (current freshness-decayed ranker score incl. skip penalty, normalized) paired
// with intended_share (same, minus the skip penalty) and skip_pct. A big
// intended slice you mostly skip is the inefficiency signal.
export interface InsightsSource {
  source_id: number;
  source_title: string;
  interest: InterestRef | null; // primary interest; null for a interestless source
  effective_share: number; // 0..1, sums to 1 across sources
  intended_share: number; // 0..1, "wants to be" (no skip penalty)
  skip_pct: number; // 0..1
  item_count: number;
  weight: number; // current multiplier (map via bucketOf for the control)
}

export interface InsightsInterest {
  interest: InterestRef | null; // null = interestless bucket
  effective_share: number;
  intended_share: number;
  source_count: number;
  item_count: number;
}

export interface InsightsResponse {
  scope: "all" | "interest";
  interest?: string; // slug, when scope === "interest"
  sources: InsightsSource[];
  interests: InsightsInterest[];
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

// Display relabel (#89): built-ins keep their backend slugs but read as
// "Favorites" (liked) and "Read Later" (watch-later) everywhere in the UI.
// Saved and user lists show their stored name. One place so the browse view and
// the Save picker never disagree on a name.
export function collectionDisplayName(c: Collection): string {
  if (c.kind === "builtin") {
    if (c.slug === "liked") return "Favorites";
    if (c.slug === "watch-later") return "Read Later";
  }
  return c.name;
}

// An item within a collection, carrying when it was added (#89). The review
// surface sorts by added_at ("when I saved it") or the item's published_at.
export interface CollectionItem extends Item {
  added_at: string;
}

// Collection review sort (#89): "saved" orders by when the item was added,
// "published" by its publish time. Both newest-first. Default saved.
export type CollectionSort = "saved" | "published";

// A mix (#86): a user-created overlay gathering several interests (many-to-many).
// interest_count is the denormalized membership size.
export interface Mix {
  id: number;
  name: string;
  slug: string;
  icon: string; // flat glyph key (see lib/feedIcons); "" = unset
  sort: number;
  created_at: string;
  interest_count: number;
}

// MixBrowse is GET /mixes/{id}: the mix's member interests and the sources
// aggregated across them (Mix -> Interest -> Source).
export interface MixBrowse {
  interests: Interest[];
  sources: Source[];
}

// User settings (#68). fast_scroll_checkin gates the dwell/engagement
// measurement + the fast-scroll check-in nudge. Off = the old explicit-only
// behavior: no dwell measured, no nudge. (The #76 multi-interest half-life rule was
// removed in #86 - a source now has exactly one interest, so there's nothing to pick.)
export interface Settings {
  fast_scroll_checkin: boolean;
}

// Appearance preferences (#80/#81/#82). Display-only: reader typography, card
// styling, and the intent-page session-length presets. Never read by the ranker.
// The server fills defaults for a fresh user, so this is always fully populated.
// #90: font_family and ink are curated enum keys (not free-form) - the client
// maps them to a system font stack / grayscale ink so styling stays on-theme.
export type FontKey = "charter" | "book" | "didot" | "grotesk";
export type InkKey = "ink" | "graphite" | "soft" | "mute";
// #97: the interest pill ink can also be "interest" (keep the interest's own color tint).
export type InterestInkKey = InkKey | "interest";
// #97: curated byline delimiter glyph keys.
export type DelimKey = "dot" | "pipe" | "slash" | "space";
export interface ReaderPrefs {
  font_size: number; // px
  line_height: number; // unitless
  measure: number; // max line length, ch
  images: boolean; // render images inside the reader body
  font_family: FontKey; // #90 curated body face
  font_weight: number; // #90 body weight, 300-700
  ink: InkKey; // #90 body ink shade
}
export interface CardPrefs {
  meta_size: number; // #97 author line size, px
  source_size: number; // source label, px
  interest_tag_size: number; // interest pill name, px
  date_size: number; // date, px
  hero_show: boolean; // show the hero/media block
  hero_color: boolean; // true = color; false = grayscale/dither
  // #97 per-element weight (300-700) + ink. Interest ink allows "interest" (keep tint).
  interest_weight: number;
  interest_ink: InterestInkKey;
  source_weight: number;
  source_ink: InkKey;
  author_weight: number;
  author_ink: InkKey;
  date_weight: number;
  date_ink: InkKey;
  // #97 byline delimiter: separator glyph + byline spacing (px).
  delim: DelimKey;
  delim_gap: number;
  // legacy shared meta (pre-#97), retained for back-compat migration only.
  meta_weight: number;
  meta_ink: InkKey;
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

  interests: () => req<Interest[]>("GET", "/interests"),
  createInterest: (name: string, color?: string) =>
    req<Interest>("POST", "/interests", { name, color: color ?? "" }),
  updateInterest: (
    id: number,
    patch: {
      name?: string;
      color?: string;
      icon?: string;
      half_life_days?: number;
      archive_after_days?: number; // #115: 0 inherit-global, -1 evergreen, N days
    },
  ) => req<{ ok: boolean }>("PATCH", `/interests/${id}`, patch),
  setInterestSources: (interestId: number, sourceIds: number[]) =>
    req<{ ok: boolean }>("PUT", `/interests/${interestId}/sources`, { source_ids: sourceIds }),

  // Mixes (#86): a user-created overlay grouping interests (many-to-many). CRUD +
  // interest-assignment + a browse endpoint (its interests + aggregated sources).
  mixes: () => req<Mix[]>("GET", "/mixes"),
  createMix: (name: string, icon?: string) =>
    req<Mix>("POST", "/mixes", { name, icon: icon ?? "" }),
  updateMix: (id: number, patch: { name?: string; icon?: string }) =>
    req<{ ok: boolean }>("PATCH", `/mixes/${id}`, patch),
  deleteMix: (id: number) => req<{ ok: boolean }>("DELETE", `/mixes/${id}`),
  setMixInterests: (id: number, interestIds: number[]) =>
    req<{ ok: boolean }>("PUT", `/mixes/${id}/interests`, { interest_ids: interestIds }),
  mixBrowse: (id: number) => req<MixBrowse>("GET", `/mixes/${id}`),

  sources: () => req<Source[]>("GET", "/sources"),
  // Per-source stats bundle (#116), keyed by source id. One call covers the whole
  // library, so a page fetches it once and looks up by id.
  sourceStats: () => req<Record<number, SourceStats>>("GET", "/sources/stats"),
  createSource: (s: { title: string; feed_url: string; kind?: string; weight?: number; import_backlog?: boolean }) =>
    req<Source>("POST", "/sources", s),
  // #122: force (re)import of a YouTube source's backlog from the Data API.
  importBacklog: (id: number) => req<{ ok: boolean }>("POST", `/sources/${id}/import-backlog`, {}),
  updateSource: (
    id: number,
    patch: {
      weight_bucket?: string;
      state?: string;
      per_session_cap?: number;
      half_life_days?: number;
      title?: string;
      archive_after_days?: number; // #115: 0 inherit, -1 evergreen, N days
      archive_keywords?: string; // #118: comma-separated keyword list
    },
  ) => req<{ ok: boolean }>("PATCH", `/sources/${id}`, patch),
  deleteSource: (id: number) => req<{ ok: boolean }>("DELETE", `/sources/${id}`),
  // Set the source's one interest (#86). Empty slug clears it (interestless).
  setSourceInterest: (id: number, interestSlug: string) =>
    req<{ ok: boolean }>("PUT", `/sources/${id}/interest`, { interest_slug: interestSlug }),
  // Clear the user's engagement state for a source (#119) - every item unread
  // again. olderThan (RFC3339) resets only items published before it; omit to
  // reset everything.
  resetSourceMetadata: (id: number, olderThan?: string) =>
    req<{ ok: boolean }>("POST", `/sources/${id}/reset`, olderThan ? { older_than: olderThan } : {}),
  // Swap a source's feed URL and re-pull it (#119).
  replaceSourceFeedURL: (id: number, feedUrl: string) =>
    req<{ ok: boolean }>("PUT", `/sources/${id}/feed-url`, { feed_url: feedUrl }),
  sourceItems: (id: number) => req<SourceItem[]>("GET", `/sources/${id}/items`),
  // --- #66 interest-mgmt-pages block (interest page recent posts) ---
  feedItems: (interestId: number) => req<Item[]>("GET", `/interests/${interestId}/items`),
  // --- end #66 block ---

  insights: (interestSlug?: string) =>
    req<InsightsResponse>("GET", `/insights${interestSlug ? `?interest=${encodeURIComponent(interestSlug)}` : ""}`),

  // Durable sessions (#67 + #69). createSession builds + stores the queue for a
  // single duration; currentSession resumes the active one (204 -> undefined);
  // updateSession advances the cursor or ends it.
  createSession: (durationMin: number, themes: string[], mixes: string[] = []) =>
    req<SessionResponse>("POST", "/sessions", { duration_min: durationMin, themes, mixes }),
  currentSession: () => req<SessionResponse | undefined>("GET", "/sessions/current"),
  updateSession: (id: string, patch: { cursor?: number; status?: "ended" }) =>
    req<{ ok: boolean }>("PATCH", `/sessions/${id}`, patch),
  // On-demand full-text (#98): the best reader body for an item, fetched +
  // readability-extracted server-side for teaser-only interests and cached. Returns
  // content_source=external (content "") when the item isn't extractable.
  itemContent: (id: number) => req<ItemContent>("GET", `/items/${id}/content`),
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
  // sort (#89): "saved" (added_at, default) or "published" (published_at).
  collectionItems: (id: number, sort: CollectionSort = "saved") =>
    req<CollectionItem[]>("GET", `/collections/${id}/items?sort=${sort}`),
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
  commitImport: (sources: ImportCandidate[], createInterestsFromFolders: boolean) =>
    req<CommitResult>("POST", "/import/commit", {
      sources,
      create_interests_from_folders: createInterestsFromFolders,
    }),
};
