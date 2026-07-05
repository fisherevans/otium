// Content-aware engagement state for a session card (#96).
//
// The backend owns the authoritative 3-state `render` (full_text | preview |
// external) via GET /items/{id}/content (#98/#99), but that's a lazy per-item
// fetch. For the card's callout buttons we want an instant, synchronous guess
// off the item payload we already have, then optionally refine it once the
// content endpoint has been hit. `cardRender` is that synchronous guess.
//
//   - full_text: there's an in-app reader body (or we optimistically attempt one
//     for a not-yet-resolved article - the reader page fetches on open and
//     degrades gracefully if it turns out external).
//   - preview:   no full text, but a teaser/summary to show while linking out.
//   - external:  video/audio, or resolved-external with nothing to read.

import type { Item, ItemRender } from "@/api/client";

const VIDEO = new Set(["short", "long", "live"]);

// Media that plays rather than reads - always an "external"/watch path.
export function isMedia(item: Item): boolean {
  return VIDEO.has(item.media_type) || item.media_type === "audio";
}

export function isVideo(item: Item): boolean {
  return VIDEO.has(item.media_type);
}

// A synchronous best-guess render state from the item payload alone.
export function cardRender(item: Item): ItemRender {
  if (isMedia(item)) return "external"; // video/audio -> watch / open original
  const cs = item.content_source;
  // Resolved with an in-app body, or a body already shipped at ingest (#58).
  if (cs === "rss" || cs === "fetched") return "full_text";
  if (item.content?.trim()) return "full_text";
  // Resolved external: read the teaser if we have one, else pure link-out.
  if (cs === "external") return item.summary?.trim() ? "preview" : "external";
  // Pending ("" - the content endpoint hasn't resolved this item yet). Attempt
  // full text: the reader page's lazy fetch is the real arbiter (#96 "attempt
  // first"), and it falls back to open-original if nothing extractable comes.
  return "full_text";
}
