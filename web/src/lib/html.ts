// Sanitize an RSS `summary`/description for the in-app reader (#41).
//
// Feeds ship arbitrary HTML in <description>/<content:encoded>. We render it
// inline, so it is untrusted markup from the open internet - a hostile feed
// could inject scripts or tracking pixels. Rather than pull in a sanitizer dep,
// parse with the browser's DOMParser and keep only inert formatting: drop the
// whole class of active/embedding elements, strip every attribute except a
// vetted href, and force safe link rels. `textContent` never executes, so the
// emptiness probe is also safe.

const DANGER = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "IMG", "SVG", "VIDEO", "AUDIO",
  "SOURCE", "TRACK", "LINK", "META", "FORM", "INPUT", "BUTTON", "TEXTAREA",
  "SELECT", "OPTION", "CANVAS", "NOSCRIPT", "BASE", "APPLET",
]);

function cleanNode(node: Element): void {
  for (const child of Array.from(node.children)) {
    if (DANGER.has(child.tagName)) {
      child.remove();
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      if (child.tagName === "A" && name === "href") {
        if (!/^(https?:|mailto:)/i.test(attr.value.trim())) child.removeAttribute(attr.name);
        continue;
      }
      child.removeAttribute(attr.name);
    }
    if (child.tagName === "A" && child.hasAttribute("href")) {
      child.setAttribute("target", "_blank");
      child.setAttribute("rel", "noopener noreferrer");
    }
    cleanNode(child);
  }
}

export interface RenderedSummary {
  html: string;
  empty: boolean;
}

export function renderSummary(raw: string | undefined): RenderedSummary {
  if (!raw || !raw.trim()) return { html: "", empty: true };
  const doc = new DOMParser().parseFromString(raw, "text/html");
  cleanNode(doc.body);
  const text = (doc.body.textContent ?? "").trim();
  return { html: doc.body.innerHTML, empty: text.length === 0 };
}
