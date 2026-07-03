// Feed icon registry (#45). A feed's `icon` field stores a stable *key* (e.g.
// "comedy"); this maps that key to a Lucide glyph. Lucide is MIT and
// tree-shakeable, so only the icons imported here ship - no icon font, no CDN.
//
// The keys cover Fisher's feed categories. Where Lucide has no exact match we
// use the closest clean single-ink glyph (comedy -> theater masks, local -> a
// map pin, disc-golf -> a disc). These are honest stand-ins, not bespoke
// silhouettes; a pixel-accurate custom set (a literal state shape, a jester) is
// a later refinement. Icons render at currentColor so they inherit the card's
// ink - never introduce a color fill.
//
// This module is deliberately pure TS: it exports component *references* and a
// lookup, and the .tsx consumers do the rendering (keeps the registry importable
// from anywhere without pulling JSX into a .ts file).

import {
  MapPin,
  Drama,
  Newspaper,
  Terminal,
  Atom,
  Music,
  Utensils,
  Car,
  Disc,
  Cpu,
  Hammer,
  Mountain,
  Clapperboard,
  Gamepad2,
  BookOpen,
  Trophy,
  Briefcase,
  Camera,
  Palette,
  HeartPulse,
  Plane,
  Landmark,
  Mic,
  PawPrint,
  Rocket,
  PenTool,
  Sprout,
  LineChart,
  Rss,
  type LucideIcon,
} from "lucide-react";

export interface FeedIconDef {
  key: string; // stored in feeds.icon
  label: string; // shown in the picker + used for search
  Icon: LucideIcon;
}

// Order here is the picker's grid order. Category keys first, generic default
// last. `label` doubles as the search term, so keep it descriptive.
export const FEED_ICONS: FeedIconDef[] = [
  { key: "local", label: "Local / region", Icon: MapPin },
  { key: "news", label: "News", Icon: Newspaper },
  { key: "comedy", label: "Comedy", Icon: Drama },
  { key: "dev", label: "Dev / code", Icon: Terminal },
  { key: "tech", label: "Tech / hardware", Icon: Cpu },
  { key: "science", label: "Science", Icon: Atom },
  { key: "music", label: "Music", Icon: Music },
  { key: "food", label: "Food / cooking", Icon: Utensils },
  { key: "cars", label: "Cars", Icon: Car },
  { key: "disc-golf", label: "Disc golf", Icon: Disc },
  { key: "making", label: "Making / DIY", Icon: Hammer },
  { key: "outdoors", label: "Outdoors", Icon: Mountain },
  { key: "film", label: "Film / video", Icon: Clapperboard },
  { key: "games", label: "Games", Icon: Gamepad2 },
  { key: "reading", label: "Reading / essays", Icon: BookOpen },
  { key: "writing", label: "Writing", Icon: PenTool },
  { key: "sports", label: "Sports", Icon: Trophy },
  { key: "business", label: "Business / finance", Icon: Briefcase },
  { key: "markets", label: "Markets / data", Icon: LineChart },
  { key: "photography", label: "Photography", Icon: Camera },
  { key: "art", label: "Art / design", Icon: Palette },
  { key: "health", label: "Health / fitness", Icon: HeartPulse },
  { key: "travel", label: "Travel", Icon: Plane },
  { key: "history", label: "History / politics", Icon: Landmark },
  { key: "podcast", label: "Podcast / audio", Icon: Mic },
  { key: "nature", label: "Nature / animals", Icon: PawPrint },
  { key: "garden", label: "Garden", Icon: Sprout },
  { key: "space", label: "Space", Icon: Rocket },
  { key: "default", label: "Generic feed", Icon: Rss },
];

const BY_KEY: Record<string, LucideIcon> = Object.fromEntries(FEED_ICONS.map((d) => [d.key, d.Icon]));

// feedIcon resolves a stored key to its Lucide component, or null when the key
// is unset/unknown (the caller then falls back to the feed's color swatch).
export function feedIcon(key?: string | null): LucideIcon | null {
  if (!key) return null;
  return BY_KEY[key] ?? null;
}
