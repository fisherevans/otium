// Parse a YouTube video id from an item URL so a video item can play inline
// (#51) via a youtube-nocookie embed instead of navigating to youtube.com.
// Handles the shapes RSS feeds actually ship: watch?v=, youtu.be/, /embed/,
// /shorts/, /v/, /live/. Returns null when the URL isn't a recognizable
// YouTube video (caller falls back to "open original").
//
// A YouTube id is 11 chars of [A-Za-z0-9_-]; we validate to avoid feeding a
// stray path segment into the embed src.
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const PATH_PREFIXES = ["embed", "shorts", "v", "live"];

function valid(id: string | null | undefined): string | null {
  return id && ID_RE.test(id) ? id : null;
}

export function parseYouTubeId(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");

  if (host === "youtu.be") {
    return valid(u.pathname.split("/").filter(Boolean)[0]);
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host.endsWith(".youtube.com")) {
    if (u.pathname === "/watch") return valid(u.searchParams.get("v"));
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && PATH_PREFIXES.includes(parts[0])) return valid(parts[1]);
  }
  return null;
}

export function embedUrl(id: string): string {
  // rel=0 keeps end-screen suggestions to the same channel; nocookie host is the
  // privacy-forward embed domain (no cookies until playback).
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;
}
