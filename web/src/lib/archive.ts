// Archive-After vocabulary (session engine v2, #115). A source/topic expires an
// item from eligibility once it's older than this window. The value is stored as
// an int: N days, plus two sentinels - 0 means "inherit" (the source falls back to
// its topic, the topic to the global default) and -1 means "evergreen" (never
// archive). One place so the topic page, the source page, and their modals all
// speak the same options and labels.
import { ageDays } from "./format";

// The quick preset windows, longest-lived last (#120). `0` (inherit) and `-1`
// (none/evergreen) are NOT listed here: inherit is added per-scope by the picker,
// and none lives under Custom. Anything off this list is a Custom value (N days).
export const ARCHIVE_PRESETS: { days: number; label: string }[] = [
  { days: 1, label: "24 hours" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
];

// Custom-picker units. Stored as days (month≈30, year=365), so a custom value
// round-trips through the same archive_after_days int - no schema change.
export const ARCHIVE_UNITS: { key: string; label: string; days: number }[] = [
  { key: "day", label: "day", days: 1 },
  { key: "week", label: "week", days: 7 },
  { key: "month", label: "month", days: 30 },
  { key: "year", label: "year", days: 365 },
];

const PRESET_DAYS = new Set(ARCHIVE_PRESETS.map((p) => p.days));

// isCustomArchive is true for a stored value that isn't inherit(0) or a quick
// preset - i.e. none(-1) or an arbitrary N picked in the custom form.
export function isCustomArchive(days: number): boolean {
  return days === -1 || (days > 0 && !PRESET_DAYS.has(days));
}

// decomposeArchive turns a day count into the largest whole unit that divides it,
// to pre-fill the custom form ("60" -> 2 months, "14" -> 2 weeks, "5" -> 5 days).
export function decomposeArchive(days: number): { n: number; unit: string } {
  for (let i = ARCHIVE_UNITS.length - 1; i >= 0; i--) {
    const u = ARCHIVE_UNITS[i];
    if (days > 0 && days % u.days === 0) return { n: days / u.days, unit: u.key };
  }
  return { n: Math.max(1, days), unit: "day" };
}

// The global fallback window (days). Mirrors the backend's GlobalArchiveAfterDays.
export const GLOBAL_ARCHIVE_DAYS = 21;

// itemEligible mirrors the backend allocator's eligible(): an item can appear in a
// session unless a source auto-archive keyword matches, or it's aged past the
// resolved window (evergreen, -1, always passes). haystack is the text (title +
// summary) matched against keywords. resolvedDays comes from resolveSourceArchive.
export function itemEligible(publishedAt: string | undefined, resolvedDays: number, keywords: string[], haystack: string): boolean {
  const hay = haystack.toLowerCase();
  if (keywords.some((k) => k && hay.includes(k.toLowerCase()))) return false;
  if (resolvedDays === -1) return true;
  return ageDays(publishedAt) <= resolvedDays;
}

// archiveValue is the plain value phrase for a concrete window - "3 weeks", "never",
// "24 hours", "2 months". Unlike archiveLabel it never says "inherit"; it's the
// resolved figure, best-fit to the largest whole unit.
export function archiveValue(days: number): string {
  if (days === -1) return "never";
  if (days === 1) return "24 hours";
  for (let i = ARCHIVE_UNITS.length - 1; i >= 0; i--) {
    const u = ARCHIVE_UNITS[i];
    if (days % u.days === 0) {
      const n = days / u.days;
      return `${n} ${u.label}${n > 1 ? "s" : ""}`;
    }
  }
  return `${days} days`;
}

// A resolved archival window: the effective value plus where it came from. The
// point (#120) is that any inherited display names BOTH - the origin and the value.
export interface ResolvedArchive {
  days: number; // effective window (-1 = evergreen)
  value: string; // "3 weeks", "never"
  origin: "source" | "topic" | "global";
  originLabel: string; // "this source", "the Local default", "the global default"
  inherited: boolean;
}

// resolveSourceArchive walks the source -> topic -> global chain. srcDays/intDays
// are the raw stored values (0 = inherit, -1 = evergreen, N = days).
export function resolveSourceArchive(srcDays: number, intDays: number, topicName?: string): ResolvedArchive {
  if (srcDays !== 0) {
    return { days: srcDays, value: archiveValue(srcDays), origin: "source", originLabel: "this source", inherited: false };
  }
  if (intDays !== 0) {
    return {
      days: intDays,
      value: archiveValue(intDays),
      origin: "topic",
      originLabel: topicName ? `the ${topicName} default` : "the topic default",
      inherited: true,
    };
  }
  return { days: GLOBAL_ARCHIVE_DAYS, value: archiveValue(GLOBAL_ARCHIVE_DAYS), origin: "global", originLabel: "the global default", inherited: true };
}

// resolveTopicArchive walks the topic -> global chain.
export function resolveTopicArchive(intDays: number): ResolvedArchive {
  if (intDays !== 0) {
    return { days: intDays, value: archiveValue(intDays), origin: "topic", originLabel: "this topic", inherited: false };
  }
  return { days: GLOBAL_ARCHIVE_DAYS, value: archiveValue(GLOBAL_ARCHIVE_DAYS), origin: "global", originLabel: "the global default", inherited: true };
}
