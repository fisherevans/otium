import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, type Conversation, type ConversationComment, type ConversationPageKind, type ConversationPerson, type Item } from "@/api/client";

// The conversation around an item (#200): fetched on demand, one item at a time,
// and kept for the life of the page. The server caches upstream for a few
// minutes; this cache only stops the same card from asking twice while it is on
// screen. A card never waits for it - it renders, then the conversation joins
// when it arrives.

export type ConversationPlatform = Conversation["platform"];

/** A cheap client-side guess at whether an item can have a conversation, so
 *  ordinary articles never make the request. The server is authoritative. */
export function conversationPlatform(item: Item): ConversationPlatform | null {
  let u: URL;
  try {
    u = new URL(item.url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m)\./, "");
  if (host === "bsky.app") return "bluesky";
  if (host === "youtube.com" || host === "youtu.be") return "youtube";
  if (/^\/p\/[^/]+/.test(u.pathname)) return "substack";
  return null;
}

/** Where a conversation is shown inline on a card, if anywhere: social posts
 *  and landscape long videos. Shorts use the overlay instead. */
export function inlineConversation(item: Item): boolean {
  const p = conversationPlatform(item);
  if (p === "bluesky" || p === "substack") return item.media_type !== "short" && item.media_type !== "long";
  if (p === "youtube") return (item.media_type === "long" || item.media_type === "live") && !(item.aspect_ratio > 0 && item.aspect_ratio < 0.95);
  return false;
}

type Entry = { state: "loading" } | { state: "ready"; conv: Conversation | null } | { state: "error"; at: number };

const entries = new Map<number, Entry>();
const listeners = new Set<() => void>();
const RETRY_MS = 60_000;

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Start loading an item's conversation if it may have one and isn't cached. */
export function loadConversation(item: Item | null | undefined): void {
  if (!item || !conversationPlatform(item)) return;
  const e = entries.get(item.id);
  if (e && (e.state !== "error" || Date.now() - e.at < RETRY_MS)) return;
  entries.set(item.id, { state: "loading" });
  emit();
  api
    .itemConversation(item.id)
    .then((conv) => entries.set(item.id, { state: "ready", conv: conv ?? null }))
    .catch(() => entries.set(item.id, { state: "error", at: Date.now() }))
    .finally(emit);
}

/** The cached conversation, or null while loading / when there is none. */
export function cachedConversation(id: number | undefined): Conversation | null {
  if (id == null) return null;
  const e = entries.get(id);
  return e?.state === "ready" ? e.conv : null;
}

/** The item's conversation; fetches it when `fetch` is set (the focused card). */
export function useConversation(item: Item | null | undefined, fetch = true): Conversation | null {
  return useConversationState(item, fetch).conv;
}

/** As useConversation, plus whether it is still loading or failed. */
export function useConversationState(item: Item | null | undefined, fetch = true): { conv: Conversation | null; status: "none" | "loading" | "ready" | "error" } {
  const id = item?.id;
  const entry = useSyncExternalStore(subscribe, () => (id == null ? undefined : entries.get(id)));
  useEffect(() => {
    if (fetch) loadConversation(item);
    // Keyed on identity: the session re-renders every second with fresh refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fetch]);
  if (!entry) return { conv: null, status: "none" };
  return entry.state === "ready" ? { conv: entry.conv, status: "ready" } : { conv: null, status: entry.state };
}

/** True when the conversation has anything worth showing. */
export function hasConversation(c: Conversation | null | undefined): c is Conversation {
  return !!c && (c.replies.length > 0 || c.quotes.length > 0 || !!c.quoted || c.counts.likes + c.counts.reposts + c.counts.replies + c.counts.quotes > 0);
}

export function platformName(p: ConversationPlatform | string): string {
  return p === "bluesky" ? "Bluesky" : p === "substack" ? "Substack" : p === "medium" ? "Medium" : p === "tumblr" ? "Tumblr" : p === "youtube" ? "YouTube" : "";
}

/** 1234 -> "1.2K", 1_250_000 -> "1.3M". */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** "12 more replies and 3 quotes" - what the card's link opens. Empty when the
 *  card already shows everything. */
export function moreLabel(c: Conversation, shown: number): string {
  const [one, many] = c.platform === "bluesky" ? ["reply", "replies"] : ["comment", "comments"];
  const rest = Math.max(0, Math.max(c.counts.replies, c.replies.length) - shown);
  const quotes = Math.max(c.counts.quotes, c.quotes.length);
  const parts: string[] = [];
  if (rest > 0) parts.push(`${compactCount(rest)} ${shown > 0 ? "more " : ""}${rest === 1 ? one : many}`);
  if (quotes > 0) parts.push(`${compactCount(quotes)} ${quotes === 1 ? "quote" : "quotes"}`);
  return parts.join(" and ");
}

// --- paging (#209) ---------------------------------------------------------
//
// The reader keeps the conversation going as you scroll. The first answer
// carries the first page of replies (and quotes) and `cursors` for the rest; the
// reader asks for the next page in order - replies, then quotes - when its end comes near (an IntersectionObserver), and a reply cut
// off at the fetched depth loads its own replies when tapped. One request at a
// time; a failure stops and offers Retry, never spins.

// #210: who reposted is not shown (Fisher: useless), so it is never paged.
const PAGE_ORDER = ["replies", "quotes"] as const;
type PagedKind = (typeof PAGE_ORDER)[number];

export interface ConversationPages {
  replies: ConversationComment[];
  quotes: ConversationComment[];
  reposts: ConversationPerson[];
  /** loading = a page is on its way; error = the last one failed (Retry). */
  status: "idle" | "loading" | "error";
  /** True while another page exists. With status "error" it waits for Retry. */
  hasMore: boolean;
  /** Load the next page, if there is one and nothing is in flight. */
  loadMore: () => void;
  /** The replies under one reply ("Show N more replies"). */
  expand: (id: string) => void;
  /** Per reply id: its thread is loading, or failed. */
  expanding: Record<string, "loading" | "error">;
}

function keyOf(c: ConversationComment): string {
  return c.id || c.url || `${c.author}|${c.published_at}|${c.text.slice(0, 40)}`;
}

function appendNew<T>(have: T[], more: T[], key: (t: T) => string): T[] {
  const seen = new Set(have.map(key));
  return have.concat(more.filter((m) => !seen.has(key(m))));
}

/** Replace the replies under the comment `id`, wherever it is in the tree. */
function withChildren(cs: ConversationComment[], id: string, kids: ConversationComment[]): ConversationComment[] {
  return cs.map((c) => {
    if (c.id === id) return { ...c, children: appendNew(c.children ?? [], kids, keyOf), more_replies: 0 };
    if (c.children?.length) return { ...c, children: withChildren(c.children, id, kids) };
    return c;
  });
}

/** The conversation, growing page by page. `conv` is the first answer. */
export function useConversationPages(item: Item | null | undefined, conv: Conversation | null): ConversationPages {
  const id = item?.id;
  const [state, setState] = useState(() => initial(conv));
  const [status, setStatus] = useState<ConversationPages["status"]>("idle");
  const [expanding, setExpanding] = useState<Record<string, "loading" | "error">>({});
  const inflight = useRef(false);
  const live = useRef(0);

  // A new item (or a refetched first page) starts over.
  useEffect(() => {
    live.current++;
    inflight.current = false;
    setState(initial(conv));
    setStatus("idle");
    setExpanding({});
  }, [id, conv]);

  const loadMore = useCallback(() => {
    const next = state.next;
    if (id == null || !next || inflight.current) return;
    inflight.current = true;
    const gen = live.current;
    setStatus("loading");
    api
      .itemConversationMore(id, next.kind, next.cursor)
      .then((page) => {
        if (gen !== live.current) return;
        setState((s) => advance(s, next.kind, page?.cursor, page?.items ?? [], page?.people ?? []));
        setStatus("idle");
      })
      .catch(() => gen === live.current && setStatus("error"))
      .finally(() => {
        if (gen === live.current) inflight.current = false;
      });
  }, [id, state.next]);

  const expand = useCallback(
    (ref: string) => {
      if (id == null || expanding[ref] === "loading") return;
      const gen = live.current;
      setExpanding((e) => ({ ...e, [ref]: "loading" }));
      api
        .itemConversationMore(id, "thread", "", ref)
        .then((page) => {
          if (gen !== live.current) return;
          setState((s) => ({ ...s, replies: withChildren(s.replies, ref, page?.items ?? []) }));
          setExpanding((e) => {
            const { [ref]: _, ...rest } = e;
            return rest;
          });
        })
        .catch(() => gen === live.current && setExpanding((e) => ({ ...e, [ref]: "error" })));
    },
    [id, expanding],
  );

  return { replies: state.replies, quotes: state.quotes, reposts: state.reposts, status, hasMore: !!state.next, loadMore, expand, expanding };
}

interface PagesState {
  replies: ConversationComment[];
  quotes: ConversationComment[];
  reposts: ConversationPerson[];
  next: { kind: ConversationPageKind; cursor: string } | null;
  /** Cursors still to visit, in PAGE_ORDER. */
  queue: Partial<Record<PagedKind, string>>;
}

function initial(conv: Conversation | null): PagesState {
  const { reposts: _ignored, ...cursors } = conv?.cursors ?? {};
  const queue: Partial<Record<PagedKind, string>> = cursors;
  const s: PagesState = { replies: conv?.replies ?? [], quotes: conv?.quotes ?? [], reposts: [], next: null, queue };
  return { ...s, next: nextIn(queue) };
}

function nextIn(queue: Partial<Record<PagedKind, string>>): PagesState["next"] {
  for (const k of PAGE_ORDER) if (queue[k] !== undefined) return { kind: k, cursor: queue[k]! };
  return null;
}

function advance(s: PagesState, kind: ConversationPageKind, cursor: string | undefined, items: ConversationComment[], people: ConversationPerson[]): PagesState {
  const queue = { ...s.queue };
  if (kind === "replies" || kind === "quotes") {
    if (cursor) queue[kind] = cursor;
    else delete queue[kind];
  }
  const out: PagesState = { ...s, queue };
  if (kind === "replies") out.replies = appendNew(s.replies, items, keyOf);
  if (kind === "quotes") out.quotes = appendNew(s.quotes, items, keyOf);
  if (kind === "reposts") out.reposts = appendNew(s.reposts, people, (p) => p.handle || p.url || p.name);
  out.next = nextIn(queue);
  return out;
}
