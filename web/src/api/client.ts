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
  added_at: string;
  last_fetch_at?: string;
  fetch_error?: string;
  feed_slugs?: string[];
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
  summary: string;
  author: string;
  thumbnail_url: string;
  media_type: string;
  duration_sec: number;
  published_at: string;
  fetched_at: string;
}

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

  sources: () => req<Source[]>("GET", "/sources"),
  createSource: (s: { title: string; feed_url: string; kind?: string; weight?: number }) =>
    req<Source>("POST", "/sources", s),
  updateSource: (
    id: number,
    patch: { weight_bucket?: string; state?: string; per_session_cap?: number; title?: string },
  ) => req<{ ok: boolean }>("PATCH", `/sources/${id}`, patch),
  deleteSource: (id: number) => req<{ ok: boolean }>("DELETE", `/sources/${id}`),
  setSourceFeeds: (id: number, feedSlugs: string[]) =>
    req<{ ok: boolean }>("PUT", `/sources/${id}/feeds`, { feed_slugs: feedSlugs }),
  sourceItems: (id: number) => req<Item[]>("GET", `/sources/${id}/items`),

  mix: (feedSlug?: string) =>
    req<MixResponse>("GET", `/mix${feedSlug ? `?feed=${encodeURIComponent(feedSlug)}` : ""}`),

  buildSession: (minLow: number, minHigh: number, themes: string[]) =>
    req<BuildResponse>("POST", "/session", { min_low: minLow, min_high: minHigh, themes }),
  itemEvent: (id: number, type: string, sessionId?: string) =>
    req<{ ok: boolean }>("POST", `/items/${id}/event`, { type, session_id: sessionId ?? "" }),
  fetchNow: () => req<{ new_items: number }>("POST", "/fetch"),

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
