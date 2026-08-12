// Sanitize an RSS `summary`/description/full-text body for the in-app reading
// surfaces (#41, images #142).
//
// Topics ship arbitrary HTML in <description>/<content:encoded>. We render it
// via dangerouslySetInnerHTML, so it is untrusted markup from the open internet
// - a hostile topic Fisher follows could try to inject script or tracking into
// otium's authenticated origin. otium-web sets no CSP, so this is the only guard.
// Use DOMPurify (the vetted standard) rather than a hand-rolled cleaner: it
// closes the whole mXSS class (foreign-content / namespace confusion) that an
// ad-hoc DOM walk misses.
//
// #142: the reader now renders IMAGES (and a narrow allowlist of video embeds),
// not just text. Fisher wants to actually see the article's photos/figures
// inline instead of stranded alt text. Images are the safe, universal win;
// iframes are restricted to a host allowlist (YouTube/Vimeo) because an arbitrary
// iframe is a clickjacking / phishing surface on our authenticated origin.

import DOMPurify from "dompurify";

// Formatting + inline media. img/figure carry the article's photos; a narrow
// iframe allowlist (enforced below) carries embedded video. No svg/object/form/
// style/script - those stay out.
const ALLOWED_TAGS = [
  "p", "br", "hr", "span", "div",
  "a", "b", "strong", "i", "em", "u", "s", "small", "mark", "sub", "sup", "abbr",
  "blockquote", "q", "cite", "pre", "code", "kbd", "samp",
  "ul", "ol", "li", "dl", "dt", "dd",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption",
  "figure", "figcaption",
  "img", "picture", "source",
  "iframe",
];

const ALLOWED_ATTR = [
  "href",
  // img / picture / source
  "src", "srcset", "sizes", "alt", "title", "width", "height", "loading", "decoding", "referrerpolicy", "media", "type",
  // iframe (host-gated below)
  "allow", "allowfullscreen", "frameborder",
];

// Hosts whose iframes we trust enough to render inline. Anything else is dropped
// (the surrounding text still reads; only the embed goes). Matched on the URL's
// hostname by suffix so subdomains (www., player.) are covered.
const IFRAME_HOSTS = [
  "youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
  "player.vimeo.com",
  "vimeo.com",
];

function iframeAllowed(src: string): boolean {
  try {
    const u = new URL(src, window.location.origin);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    return IFRAME_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

// Registered once at module load; DOMPurify hooks are global but this module is
// the only caller. Drop iframes to non-allowlisted hosts entirely.
DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName !== "iframe") return;
  const el = node as unknown as Element;
  const src = el.getAttribute?.("src") ?? "";
  if (!iframeAllowed(src)) el.parentNode?.removeChild(el);
});

// Harden the surviving attributes: links open safely in a new tab; images and
// embeds load lazily and leak no referrer to the origin host.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
  if (node.nodeName === "IMG") {
    node.setAttribute("loading", "lazy");
    node.setAttribute("decoding", "async");
    node.setAttribute("referrerpolicy", "no-referrer");
  }
  if (node.nodeName === "IFRAME") {
    node.setAttribute("loading", "lazy");
    node.setAttribute("referrerpolicy", "no-referrer");
  }
});

export interface RenderedSummary {
  html: string;
  empty: boolean;
}

// imageKey normalizes an image URL to an identity that ignores the resolution
// variant (#142): WordPress feeds ship the SAME photo twice - the prepended
// featured image (`-1024x681`) and the in-body figure (`-1200x798`) - at
// different `-WIDTHxHEIGHT` sizes, so a raw-src compare misses the duplicate.
// Strip the size suffix and the query/hash so both map to one key.
function imageKey(src: string): string {
  try {
    const u = new URL(src, window.location.origin);
    u.search = "";
    u.hash = "";
    const path = u.pathname.replace(/-\d+x\d+(?=\.[a-z0-9]+$)/i, "");
    return u.host + path;
  } catch {
    return src.trim();
  }
}

// dedupeImages drops repeated copies of the same photo, keeping the captioned
// one when there is a choice (it's the more informative version). A removed image
// takes its wrapping <figure> with it when that figure carries nothing else.
function dedupeImages(doc: Document): void {
  const groups = new Map<string, HTMLImageElement[]>();
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const key = imageKey(img.getAttribute("src") ?? "");
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(img);
  }
  const captioned = (img: HTMLImageElement) => {
    const fig = img.closest("figure");
    return !!(fig && fig.querySelector("figcaption"));
  };
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keep = group.find(captioned) ?? group[0];
    for (const img of group) {
      if (img === keep) continue;
      const fig = img.closest("figure");
      if (fig && !fig.querySelector("figcaption") && fig.querySelectorAll("img, iframe, video").length <= 1) {
        fig.remove();
      } else {
        img.remove();
      }
    }
  }
}

export function renderSummary(raw: string | undefined): RenderedSummary {
  if (!raw || !raw.trim()) return { html: "", empty: true };
  const clean = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_ATTR: ["target", "rel"], // keep the rel/target the hook adds
    ALLOW_DATA_ATTR: false,
    // javascript:/data: URIs on links are blocked by DOMPurify's default URI
    // policy; only http(s)/mailto (and data: images) survive.
  });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  dedupeImages(doc);
  const html = doc.body.innerHTML;
  // A body is "empty" only if it has neither text nor media - an image- or
  // video-only article still renders (#142), it just carries no prose.
  const text = doc.body.textContent?.trim() ?? "";
  const hasMedia = doc.body.querySelector("img, picture, iframe") !== null;
  return { html, empty: text.length === 0 && !hasMedia };
}
