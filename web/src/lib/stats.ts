import type { SourceStats } from "@/api/client";

// The single most salient engagement fact about a source (#116), for the badge on
// a source row / header. Transparency is the value here: surface the number that
// actually characterizes your relationship with the source right now.
//
// tone drives the badge color: "up" = you engage (open rate), "down" = you pass
// (skip rate), "mute" = neutral supply facts (invisible / on deck / cold). The
// picker prefers a real engagement signal (open/skip) once a source has been
// shown; before that it falls back to supply (on deck / never shown).
export type BadgeTone = "up" | "down" | "mute";
export interface EngagementBadge {
  text: string;
  tone: BadgeTone;
}

export function engagementBadge(st?: SourceStats): EngagementBadge {
  if (!st || st.total === 0) return { text: "no articles yet", tone: "mute" };
  if (st.shown === 0) {
    if (st.on_deck > 0) return { text: `${st.on_deck} on deck`, tone: "mute" };
    return { text: "not yet shown", tone: "mute" };
  }
  const open = Math.round(st.open_pct * 100);
  const skip = Math.round(st.skip_pct * 100);
  const invisible = st.total > 0 ? Math.round((st.invisible / st.total) * 100) : 0;
  // A real engagement signal wins once it's meaningful (>=20%).
  if (open >= skip && open >= 20) return { text: `${open}% open rate`, tone: "up" };
  if (skip > open && skip >= 20) return { text: `${skip}% skip rate`, tone: "down" };
  // Otherwise, if most of the supply never surfaces, that's the salient fact.
  if (invisible >= 50) return { text: `${invisible}% invisible`, tone: "mute" };
  // Low-signal fallback: lead with whichever engagement number is larger.
  return open >= skip
    ? { text: `${open}% open rate`, tone: "up" }
    : { text: `${skip}% skip rate`, tone: "down" };
}

// The source subline used under the badge: "RSS · 2 articles/day · 9 on deck".
export function sourceSubline(kind: string, st?: SourceStats): string {
  const parts: string[] = [kind.toUpperCase()];
  if (st) {
    const pd = st.per_day;
    if (pd > 0) parts.push(`${pd < 1 ? pd.toFixed(1) : Math.round(pd)} ${pd === 1 ? "article" : "articles"}/day`);
    if (st.on_deck > 0) parts.push(`${st.on_deck} on deck`);
  }
  return parts.join(" · ");
}
