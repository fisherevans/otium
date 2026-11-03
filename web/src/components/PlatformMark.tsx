import { Podcast, Rss } from "lucide-react";

// PlatformMark (#205): the small mark beside a source's name that says where an
// item comes from - an RSS feed, Bluesky, Substack, Medium, YouTube or a podcast -
// so a reporter's Bluesky post never reads like their outlet's article.
//
// Monochrome on purpose: it inherits the meta text's colour (currentColor) and
// sits at that text's size, so it identifies without competing. Lucide covers RSS
// and podcasts; it ships no brand glyphs, so the four platform marks are small
// inline paths, simplified to read at 12-14px.

const LABEL: Record<string, string> = {
  rss: "RSS feed",
  youtube: "YouTube",
  podcast: "Podcast",
  bluesky: "Bluesky",
  substack: "Substack",
  medium: "Medium",
};

/** The platform's name for a source kind, or "" for a kind with no mark. */
export function platformLabel(kind?: string): string {
  return (kind && LABEL[kind]) || "";
}

export function PlatformMark({ kind, size = 13 }: { kind?: string; size?: number }) {
  const label = platformLabel(kind);
  if (!label) return null;
  const common = { className: "platform-mark", width: size, height: size, role: "img", "aria-label": label } as const;
  switch (kind) {
    case "rss":
      return <Rss {...common} strokeWidth={2.2} />;
    case "podcast":
      return <Podcast {...common} strokeWidth={2} />;
    case "youtube":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="currentColor">
          <title>{label}</title>
          <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
        </svg>
      );
    case "bluesky":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="currentColor">
          <title>{label}</title>
          <path d="M6.3 3.9C8.6 5.6 11.1 9.1 12 11c.9-1.9 3.4-5.4 5.7-7.1 1.7-1.2 4.3-2.2 4.3.8 0 .6-.3 5.1-.5 5.8-.7 2.5-3.3 3.2-5.6 2.8 4 .7 5.1 3 2.9 5.2-4.2 4.3-6-1.1-6.5-2.5l-.3-.7-.3.7c-.5 1.4-2.3 6.8-6.5 2.5-2.2-2.2-1.1-4.5 2.9-5.2-2.3.4-4.9-.3-5.6-2.8C2.3 9.8 2 5.3 2 4.7c0-3 2.6-2 4.3-.8Z" />
        </svg>
      );
    case "substack":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="currentColor">
          <title>{label}</title>
          <path d="M4 3h16v2.4H4V3Zm0 4.5h16v2.4H4V7.5ZM4 12h16v9l-8-4.5L4 21v-9Z" />
        </svg>
      );
    case "medium":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="currentColor">
          <title>{label}</title>
          <ellipse cx="7" cy="12" rx="5.5" ry="5.6" />
          <ellipse cx="16.2" cy="12" rx="2.7" ry="5.2" />
          <ellipse cx="21.2" cy="12" rx="1" ry="4.6" />
        </svg>
      );
  }
  return null;
}
