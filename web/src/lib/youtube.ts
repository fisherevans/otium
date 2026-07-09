// Parse a YouTube video id from an item URL so a video item can play inline
// (#51) via a youtube-nocookie embed instead of navigating to youtube.com.
// Handles the shapes RSS topics actually ship: watch?v=, youtu.be/, /embed/,
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

// embedUrl builds the nocookie embed src. rel=0 keeps end-screen suggestions to
// the same channel; nocookie is the privacy-forward host (no cookies until
// playback); playsinline=1 stops iOS from forcing native fullscreen.
//
// autoplay (#5): appends autoplay=1 so the player attempts to start the moment
// the sheet opens ("one click to watch"). Browsers gate audible autoplay behind a
// user gesture inside the iframe's own document - the click that opened the sheet
// doesn't transfer - so Firefox (and the Palma e-ink browser) block the audible
// start and show a play button (one tap). Chrome autoplays where site engagement
// permits. We do NOT mute to force a guaranteed start: a muted video isn't
// "watching," and a single tap-to-play beats a silent autostart. Flip to a muted
// autoplay here if guaranteed motion is ever preferred over sound.
export function embedUrl(id: string, opts?: { autoplay?: boolean }): string {
  const p = new URLSearchParams({ rel: "0", modestbranding: "1", playsinline: "1" });
  if (opts?.autoplay) p.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${id}?${p.toString()}`;
}
