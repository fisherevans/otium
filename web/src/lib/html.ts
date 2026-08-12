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

export function renderSummary(raw: string | undefined): RenderedSummary {
  if (!raw || !raw.trim()) return { html: "", empty: true };
  const html = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_ATTR: ["target", "rel"], // keep the rel/target the hook adds
    ALLOW_DATA_ATTR: false,
    // javascript:/data: URIs on links are blocked by DOMPurify's default URI
    // policy; only http(s)/mailto (and data: images) survive.
  });
  // A body is "empty" only if it has neither text nor media - an image- or
  // video-only article still renders (#142), it just carries no prose.
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = doc.body.textContent?.trim() ?? "";
  const hasMedia = doc.body.querySelector("img, picture, iframe") !== null;
  return { html, empty: text.length === 0 && !hasMedia };
}
