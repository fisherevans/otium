import { ageDays } from "./format";

// Article freshness score: recency-only decay, 0.5^(age/halfLife). Mirrors the
// backend's session.freshnessHalfLifeDays. This is the FRESHNESS half-life, a
// distinct concept from the Archive-After eligibility window (lib/archive) even
// though both default to 21 days today - don't collapse them.
export const FRESHNESS_HALF_LIFE_DAYS = 21;

export function freshness(iso: string | undefined, halfLifeDays: number = FRESHNESS_HALF_LIFE_DAYS): number {
  const a = ageDays(iso);
  if (!Number.isFinite(a)) return 0;
  return Math.pow(0.5, a / (halfLifeDays > 0 ? halfLifeDays : FRESHNESS_HALF_LIFE_DAYS));
}
