import type { Item } from "@/api/client";

// Social posts (#205). A Bluesky post (X later, #198) has no headline: its text
// is the content and its author's avatar is identity, not a picture. The server
// marks these items (`post`, `text`), so nothing here guesses from the payload.

export function isPost(item: Item): boolean {
  return !!item.post;
}

/** The post's whole text; falls back to the stored first line and remainder. */
export function postText(item: Item): string {
  if (item.text) return item.text;
  const t = item.title.trim();
  const s = item.summary?.trim() ?? "";
  if (!s) return t;
  return t.endsWith("…") ? s : `${t}\n${s}`;
}

/**
 * The one line that names an item in a list, a sheet title or a message: the
 * title, or a post's text on one line, clipped near `max` characters at a word.
 * Mirrors store.Item.Headline on the server.
 */
export function headline(item: Item, max = 120): string {
  if (!isPost(item)) return item.title;
  const line = postText(item).split(/\s+/).filter(Boolean).join(" ");
  const chars = Array.from(line);
  if (chars.length <= max) return line;
  let cut = chars.slice(0, max).join("");
  const sp = cut.lastIndexOf(" ");
  if (sp > max / 2) cut = cut.slice(0, sp);
  return cut.replace(/[\s,.;:]+$/, "") + "…";
}

/**
 * A post's picture, when it has a real one. A link card can carry the linked
 * profile's avatar as its thumbnail; that is identity, never a hero (#205).
 */
export function postMediaURL(item: Item, avatarURL?: string): string {
  const u = item.thumbnail_url;
  if (!u || u === avatarURL || u.includes("/img/avatar/")) return "";
  return u;
}
