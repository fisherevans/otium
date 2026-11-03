import { useEffect, useSyncExternalStore } from "react";
import { api, type Conversation, type Item } from "@/api/client";

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

export function platformName(p: ConversationPlatform): string {
  return p === "bluesky" ? "Bluesky" : p === "substack" ? "Substack" : "YouTube";
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
