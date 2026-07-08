import type { SourceStats } from "@/api/client";

// Source insight badges (#120). Pills are rare by construction - a source only
// earns one when it stands out, so they stay signal not noise. Two signals now,
// both open-rate-centric (everything you don't open is one thing - "not opened"):
//
//   open rate  - relative to your other sources: top ~10% (you open lots of it, a
//                positive) or bottom ~10% (you open little of it, worth a look).
//                Percentile-based, over the rolling 30-day window.
//   invisible  - its content ages out before you ever see it. Absolute threshold,
//                time-based (items published since you added it), so the import
//                backfill doesn't trip it.
export type BadgeTone = "up" | "down" | "mute";
export type InsightKind = "open" | "invisible";
export interface EngagementBadge {
  text: string;
  tone: BadgeTone;
  kind: InsightKind;
}

const MIN_SHOWN_30 = 5; // 30-day presentations before a source's open rate is trustworthy
const MIN_RESOLVED = 8; // since-added items resolved before invisibility means anything
const MIN_BAND_SOURCES = 4; // need at least this many qualifying sources to define percentiles
const INSIGHT_HI = 0.8; // invisibility bar (kept absolute)

export interface OpenRateBands {
  p10: number;
  p90: number;
}

// openRateBands computes the 10th/90th percentile of 30-day open rate across the
// sources with enough presentations to trust (so a 1-shown, 0-opened source can't
// define the bottom band). Returns null when too few sources qualify.
export function openRateBands(all: SourceStats[]): OpenRateBands | null {
  const rates = all
    .filter((s) => (s.shown_30 ?? 0) >= MIN_SHOWN_30)
    .map((s) => s.opened_30 / s.shown_30)
    .sort((a, b) => a - b);
  if (rates.length < MIN_BAND_SOURCES) return null;
  const pctl = (p: number) => {
    const idx = p * (rates.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return rates[lo] + (rates[hi] - rates[lo]) * (idx - lo);
  };
  return { p10: pctl(0.1), p90: pctl(0.9) };
}

// sourceInsight picks the one salient signal for a source, or null. Invisibility
// leads (if you barely see a source its open rate is off a tiny sample and
// misleads). bands come from openRateBands over the whole library.
export function sourceInsight(st?: SourceStats, bands?: OpenRateBands | null): { kind: InsightKind; pct: number; tone: BadgeTone } | null {
  if (!st) return null;
  const resolved = (st.shown_since ?? 0) + (st.missed_since ?? 0);
  if (resolved >= MIN_RESOLVED && (st.invisible_pct ?? 0) >= INSIGHT_HI) {
    return { kind: "invisible", pct: st.invisible_pct, tone: "mute" };
  }
  if (bands && bands.p90 > bands.p10 && (st.shown_30 ?? 0) >= MIN_SHOWN_30) {
    const open = st.opened_30 / st.shown_30;
    if (open >= bands.p90) return { kind: "open", pct: open, tone: "up" };
    if (open <= bands.p10) return { kind: "open", pct: open, tone: "down" };
  }
  return null;
}

export function engagementBadge(st?: SourceStats, bands?: OpenRateBands | null): EngagementBadge | null {
  const ins = sourceInsight(st, bands);
  if (!ins) return null;
  const p = Math.round(ins.pct * 100);
  if (ins.kind === "invisible") return { text: `${p}% invisible`, tone: "mute", kind: "invisible" };
  return { text: `${p}% open rate`, tone: ins.tone, kind: "open" };
}
