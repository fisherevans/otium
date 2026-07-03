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

export function bucketOf(w: number): Bucket {
  if (w <= 0.25) return "very_low";
  if (w <= 0.5) return "low";
  if (w <= 1) return "normal";
  if (w <= 2) return "high";
  return "favorite";
}
