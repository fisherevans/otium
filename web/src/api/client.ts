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
  sort: number;
  source_count?: number;
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

export interface Selected {
  item: Item;
  source_title: string;
  score: number;
  est_duration_sec: number;
  reason: string;
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
  sourceItems: (id: number) => req<Item[]>("GET", `/sources/${id}/items`),

  buildSession: (minLow: number, minHigh: number, themes: string[]) =>
    req<BuildResponse>("POST", "/session", { min_low: minLow, min_high: minHigh, themes }),
  itemEvent: (id: number, type: string, sessionId?: string) =>
    req<{ ok: boolean }>("POST", `/items/${id}/event`, { type, session_id: sessionId ?? "" }),
  fetchNow: () => req<{ new_items: number }>("POST", "/fetch"),

  // Import: parse sends the raw file text (not JSON-wrapped) so the server sees
  // the OPML/CSV bytes directly.
  parseImport: async (text: string): Promise<ParseResult> => {
    const res = await fetch("/api/v1/import/parse", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: text,
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
