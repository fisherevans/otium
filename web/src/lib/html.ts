// Sanitize an RSS `summary`/description for the in-app reader (#41).
//
// Topics ship arbitrary HTML in <description>/<content:encoded>. We render it
// via dangerouslySetInnerHTML, so it is untrusted markup from the open internet
// - a hostile topic Fisher follows could try to inject script or tracking into
// otium's authenticated origin. otium-web sets no CSP, so this is the only guard.
// Use DOMPurify (the vetted standard) rather than a hand-rolled cleaner: it
// closes the whole mXSS class (foreign-content / namespace confusion) that an
// ad-hoc DOM walk misses. We keep only inert formatting tags, allow just `href`,
// and force every surviving link to open safely in a new tab.

import DOMPurify from "dompurify";

// Inert formatting only - no img/svg/media/object/form/style. The reader is text.
const ALLOWED_TAGS = [
  "p", "br", "hr", "span", "div",
  "a", "b", "strong", "i", "em", "u", "s", "small", "mark", "sub", "sup", "abbr",
  "blockquote", "q", "cite", "pre", "code", "kbd", "samp",
  "ul", "ol", "li", "dl", "dt", "dd",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption",
  "figure", "figcaption",
];

// Force links to open in a new tab with a hardened rel. Registered once at
// module load; DOMPurify hooks are global but this module is the only caller.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
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
    ALLOWED_ATTR: ["href"],
    ADD_ATTR: ["target", "rel"], // keep the rel/target the hook adds
    ALLOW_DATA_ATTR: false,
    // javascript:/data: URIs on links are blocked by DOMPurify's default URI
    // policy; only http(s)/mailto survive.
  });
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ?? "";
  return { html, empty: text.length === 0 };
}
