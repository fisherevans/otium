import type { Conversation, Item, PostBody } from "@/api/client";

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
  if (!isPost(item) || item.post_body?.title) return item.title;
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

/**
 * The structured post to render (#207). The server sends `post_body` for posts
 * fetched since #207; an older one is rebuilt from what the item has - its text,
 * the source as author, its picture - so every post renders through one path.
 */
export function postBody(item: Item, sourceTitle: string, sourceIcon?: string): PostBody {
  if (item.post_body) {
    const b = item.post_body;
    return { ...b, author: { ...b.author, name: b.author.name || sourceTitle, avatar: b.author.avatar || sourceIcon } };
  }
  const pic = postMediaURL(item, sourceIcon);
  return {
    author: { name: sourceTitle || item.author, avatar: sourceIcon },
    segments: [{ text: postText(item) }],
    images: pic ? [{ thumb: pic }] : undefined,
  };
}

/** Engagement for the post's row: live conversation counts when loaded, else
 *  the counts stored at the last fetch (reposts there already include quotes). */
export function postCounts(item: Item, conv?: Conversation | null): { replies: number; reposts: number; likes: number } {
  if (conv) return { replies: conv.counts.replies, reposts: conv.counts.reposts + conv.counts.quotes, likes: conv.counts.likes };
  return { replies: item.replies ?? 0, reposts: item.reposts ?? 0, likes: item.likes ?? 0 };
}

/** The platform a post is drawn as (#209): bluesky, or a short Substack/Medium post. */
export function postPlatform(item: Item): string {
  return item.source_kind || "bluesky";
}

/** The line under a post's author when it has no handle: its publication, when
 *  that says something the author's name does not (#209). */
export function postContext(item: Item, body: PostBody, sourceTitle?: string): string | undefined {
  if (postPlatform(item) === "bluesky" || !sourceTitle) return undefined;
  return sourceTitle.trim() !== body.author.name.trim() ? sourceTitle : undefined;
}

/** Whether the item's platform reports counts at all. Medium does not, so its
 *  posts and articles show no counts row rather than a row of zeros (#209). */
export function hasPlatformCounts(item: Item): boolean {
  return item.source_kind !== "medium";
}

/** Counts for a post's row, or null when the platform has none (#209). */
export function postRowCounts(item: Item, conv?: Conversation | null) {
  return hasPlatformCounts(item) ? postCounts(item, conv) : null;
}

/** The post with the post it quotes, from the conversation when the stored post
 *  does not carry it, or carries it without its pictures (stored before #210). */
export function withQuoted(body: PostBody, conv?: Conversation | null): PostBody {
  const q = conv?.quoted;
  if (!q) return body;
  const have = body.quote;
  if (have && (have.kind || have.images || have.link || have.video || !have.media)) return body;
  return {
    ...body,
    quote: {
      author: { name: q.author, handle: q.handle, avatar: q.avatar_url },
      segments: q.segments ?? [{ text: q.text }],
      url: q.url,
      published_at: q.published_at,
      media: q.media,
      images: q.images,
      link: q.link,
      video: q.video,
    },
  };
}
