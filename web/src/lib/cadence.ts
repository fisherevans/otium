// Posting-rate formatting (#120). A source's rate is stored as posts-per-day, but
// for infrequent sources (most YouTube channels) that reads as rounding noise -
// "0.1 articles a day". scaleCadence escalates the time unit (day → week → month →
// year) until the figure is at least ~1, so the rate shows as "3 articles a month"
// instead. The comparison math elsewhere still runs on the raw per-day value; only
// the displayed unit adapts.
export type CadenceUnit = "day" | "week" | "month" | "year";
export interface Cadence {
  value: number;
  unit: CadenceUnit;
}

const STEPS: Array<[number, CadenceUnit]> = [
  [1, "day"],
  [7, "week"],
  [30, "month"],
  [365, "year"],
];

export function scaleCadence(perDay: number): Cadence {
  // Stop at the first unit whose value rounds to >= 1 (0.95, not 1.0): a ~monthly
  // source is 0.986/month, which should read "1 article a month", not "12 a year".
  for (const [mult, unit] of STEPS) {
    if (perDay * mult >= 0.95) return { value: perDay * mult, unit };
  }
  // Below ~1/year: report per year anyway rather than inventing a bigger unit.
  return { value: perDay * 365, unit: "year" };
}

// cadenceCount renders the numeric part: a whole number once we've scaled past ~1,
// one decimal only in the sub-10 range where it still carries signal.
export function cadenceCount(value: number): string {
  if (value >= 10) return String(Math.round(value));
  const r = Math.round(value * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// cadencePhrase renders the full "3 articles a week" / "1 article a day" phrase.
export function cadencePhrase(perDay: number): string {
  if (perDay <= 0) return "no articles yet";
  const { value, unit } = scaleCadence(perDay);
  const n = cadenceCount(value);
  return `${n} ${n === "1" ? "article" : "articles"} a ${unit}`;
}
