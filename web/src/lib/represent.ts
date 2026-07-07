import type { Bucket } from "./weight";

// Representation vocabulary for the source page prose + label (#120, mockup #4).
// Representation = how much of a session a source occupies (engine v2). Shown as a
// plain-English sentence, a 1-5 dot indicator (WLEVEL), and an all-caps label.
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

// compareToAverage renders the mockup's comparative subline: "about the same as
// your average source" within a tolerance band, else "about N% more/less ...".
// `more`/`less` are the value words (e.g. "more content", "higher").
export function compareToAverage(value: number, avg: number, more: string, less: string): string {
  if (avg <= 0) return "about average across your sources";
  const diff = (value - avg) / avg;
  if (Math.abs(diff) < 0.12) return "about the same as your average source";
  const word = diff > 0 ? more : less;
  // Real libraries have volume outliers; a raw % against the mean explodes into
  // silly figures ("2954% more"). Cap into calm language past ~2.5x.
  if (Math.abs(diff) >= 2.5) return `far ${word} than your average source`;
  const pct = Math.round(Math.abs(diff) * 100);
  return `about ${pct}% ${word} than your average source`;
}
