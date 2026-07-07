import type { SourceStats } from "@/api/client";
import { cadencePhrase } from "@/lib/cadence";

// Source insight badges (#120). These pills are THRESHOLDED, not per-source
// labels: a source only earns a pill when one signal crosses a bar worth
// interrupting the user for. Most sources show no pill - that's the point, it
// keeps the pills as signal instead of noise. The three signals:
//
//   open      - you open most of what this source shows you (a positive)
//   skip      - you skip most of what it shows you ("you're passing on a lot")
//   invisible - its content ages out before you ever see it ("you're missing this")
//
// invisible uses the time-based invisible_pct (items published since you added the
// source), NOT the raw unseen count, so the import backfill doesn't trip it.
export type BadgeTone = "up" | "down" | "mute";
export type InsightKind = "open" | "skip" | "invisible";
export interface EngagementBadge {
  text: string;
  tone: BadgeTone; // color
  kind: InsightKind; // icon
}

// Bars. "A lot" is >=80% (Fisher's threshold). Min samples keep a single skip off
// two presentations, or a fresh source, from firing a pill.
export const INSIGHT_HI = 0.8;
const MIN_SHOWN = 5; // presentations before open/skip means anything
const MIN_RESOLVED = 8; // since-added items resolved (shown or aged out) before invisibility means anything

// sourceInsight picks the one salient, threshold-crossing signal for a source, or
// null if nothing crosses. Invisibility leads: if you barely ever see a source,
// its open/skip rates are computed off a handful of presentations and mislead.
export function sourceInsight(st?: SourceStats): { kind: InsightKind; pct: number } | null {
  if (!st) return null;
  const resolved = (st.shown_since ?? 0) + (st.missed_since ?? 0);
  if (resolved >= MIN_RESOLVED && (st.invisible_pct ?? 0) >= INSIGHT_HI) {
    return { kind: "invisible", pct: st.invisible_pct };
  }
  if (st.shown >= MIN_SHOWN) {
    if (st.skip_pct >= INSIGHT_HI) return { kind: "skip", pct: st.skip_pct };
    if (st.open_pct >= INSIGHT_HI) return { kind: "open", pct: st.open_pct };
  }
  return null;
}

export function engagementBadge(st?: SourceStats): EngagementBadge | null {
  const ins = sourceInsight(st);
  if (!ins) return null;
  const p = Math.round(ins.pct * 100);
  switch (ins.kind) {
    case "open":
      return { text: `${p}% open rate`, tone: "up", kind: "open" };
    case "skip":
      return { text: `${p}% skip rate`, tone: "down", kind: "skip" };
    case "invisible":
      return { text: `${p}% invisible`, tone: "mute", kind: "invisible" };
  }
}

// The source subline used under the badge: "RSS · 3 articles a month · 9 on deck".
export function sourceSubline(kind: string, st?: SourceStats): string {
  const parts: string[] = [kind.toUpperCase()];
  if (st) {
    if (st.per_day > 0) parts.push(cadencePhrase(st.per_day));
    if (st.on_deck > 0) parts.push(`${st.on_deck} on deck`);
  }
  return parts.join(" · ");
}
