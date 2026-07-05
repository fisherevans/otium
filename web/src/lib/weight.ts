// Shared 5-bucket source-weight vocabulary. The server stores weight as a float
// multiplier; the management surfaces talk in the 5 named buckets and PATCH
// `weight_bucket`. Kept here so the library page, the in-session source detail,
// and the overflow weighting control all agree on labels + thresholds.

export const BUCKETS = ["very_low", "low", "normal", "high", "favorite"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BLABEL: Record<Bucket, string> = {
  very_low: "v.low",
  low: "low",
  normal: "normal",
  high: "high",
  favorite: "fav",
};

// #93: weight = how often you want a source to surface (frequency). Two
// presentations share this vocabulary:
//   - WFREQ  → roomy frequency words for the source-config control (no truncation).
//   - WLEVEL → 1-5 density level for the compact dots+gauge indicator elsewhere.
//   - WHINT  → one-line context under each word in the control.
export const WFREQ: Record<Bucket, string> = {
  very_low: "Rarely",
  low: "Less",
  normal: "Normal",
  high: "More",
  favorite: "Favorite",
};

export const WLEVEL: Record<Bucket, number> = {
  very_low: 1,
  low: 2,
  normal: 3,
  high: 4,
  favorite: 5,
};

export const WHINT: Record<Bucket, string> = {
  very_low: "Only once in a while",
  low: "Surface less often",
  normal: "Default frequency",
  high: "Surface more often",
  favorite: "Always near the top",
};

export function bucketOf(w: number): Bucket {
  if (w <= 0.25) return "very_low";
  if (w <= 0.5) return "low";
  if (w <= 1) return "normal";
  if (w <= 2) return "high";
  return "favorite";
}
