// The representation vocabulary (#120). Representation = how much of a session a
// source occupies (session engine v2). The server stores it as a float multiplier
// on the source (the `weight` column / `weight_bucket` PATCH field - retained as
// the wire/storage name); every UI surface talks in the 5 named buckets and the
// shared labels below, so the library, source page, interest page, and the
// in-session ··· menu all agree.

export const BUCKETS = ["very_low", "low", "normal", "high", "favorite"] as const;
export type Bucket = (typeof BUCKETS)[number];

// bucketOf maps the stored float multiplier to its bucket.
export function bucketOf(w: number): Bucket {
  if (w <= 0.25) return "very_low";
  if (w <= 0.5) return "low";
  if (w <= 1) return "normal";
  if (w <= 2) return "high";
  return "favorite";
}

// REP_BLABEL: terse chip form. REP_FREQ: roomy word for the picker control.
// REP_LEVEL: 1-5 density for the dot indicator. REP_HINT: one-line context under
// each option. REP_PROSE / REP_LABEL: the source-page sentence + all-caps tag.
export const REP_BLABEL: Record<Bucket, string> = {
  very_low: "v.low",
  low: "low",
  normal: "normal",
  high: "high",
  favorite: "fav",
};

export const REP_FREQ: Record<Bucket, string> = {
  very_low: "Rarely",
  low: "Less",
  normal: "Normal",
  high: "More",
  favorite: "Favorite",
};

export const REP_LEVEL: Record<Bucket, number> = {
  very_low: 1,
  low: 2,
  normal: 3,
  high: 4,
  favorite: 5,
};

export const REP_HINT: Record<Bucket, string> = {
  very_low: "Only once in a while",
  low: "Surface less often",
  normal: "Default frequency",
  high: "Surface more often",
  favorite: "Always near the top",
};

export const REP_PROSE: Record<Bucket, string> = {
  favorite: "presented much more often than other sources",
  high: "presented more frequently than other sources",
  normal: "presented about as often as other sources",
  low: "presented less often than other sources",
  very_low: "presented only rarely",
};

export const REP_LABEL: Record<Bucket, string> = {
  favorite: "MUCH MORE REPRESENTATION",
  high: "MORE REPRESENTATION",
  normal: "NORMAL REPRESENTATION",
  low: "LESS REPRESENTATION",
  very_low: "MUCH LESS REPRESENTATION",
};

// compareToAverage renders the source-page comparative subline: "about the same as
// your average source" within a tolerance band, else "about N% more/less ...".
// `more`/`less` are the value words (e.g. "more content", "higher").
export function compareToAverage(value: number, avg: number, more: string, less: string): string {
  if (avg <= 0) return "about average across your sources";
  const diff = (value - avg) / avg;
  if (Math.abs(diff) < 0.12) return "about the same as your average source";
  // Show the real percentage (that's the useful number). Past ~2.5x a raw percent
  // gets silly ("2954% more"), so express big outliers as a clean multiple instead.
  if (diff >= 2.5) return `about ${Math.round(value / avg)}× your average source`;
  const word = diff > 0 ? more : less;
  const pct = Math.round(Math.abs(diff) * 100);
  return `about ${pct}% ${word} than your average source`;
}
