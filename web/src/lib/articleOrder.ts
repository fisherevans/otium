import type { ScoringConfig } from "@/api/client";

export type Direction = NonNullable<ScoringConfig["direction"]>;

// The per-source article orders (#124, #197), shared by the add-source wizard and
// the source page so the two never drift.
export const ARTICLE_ORDERS: { value: Direction; name: string; sub: string }[] = [
  { value: "newest", name: "Newest first", sub: "reverse chronological" },
  { value: "popular", name: "Most popular", sub: "recent posts people engaged with most" },
  { value: "oldest", name: "Oldest first", sub: "work through the backlog" },
  { value: "random", name: "Random", sub: "shuffled by age" },
];

// Source kinds whose platform reports engagement counts. Elsewhere Most popular
// has nothing to rank by, so it is not offered.
export const ENGAGEMENT_KINDS = new Set(["bluesky", "substack"]);

export function ordersFor(kind: string): typeof ARTICLE_ORDERS {
  return ENGAGEMENT_KINDS.has(kind) ? ARTICLE_ORDERS : ARTICLE_ORDERS.filter((o) => o.value !== "popular");
}
