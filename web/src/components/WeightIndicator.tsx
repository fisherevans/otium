import { Gauge } from "lucide-react";
import { WFREQ, WLEVEL, bucketOf, type Bucket } from "@/lib/weight";

// #93: the compact weight indicator - a gauge glyph (signals "how often this
// surfaces") followed by a 1-5 density scale with N dots filled. This is the
// at-a-glance form used wherever a source appears in a list or header (library
// rows, source page meta, the quick-weight sheet), replacing the boxed word
// badge. A bare word ("normal") next to an item lacks context; the gauge + dots
// give it a visual language. Deliberately NOT shown on the reading session card
// (weight is management detail - see docs/visual-simplify.html).
//
// Pass either a raw `weight` float (bucketed here) or an explicit `bucket`.
// `label` appends the frequency word for surfaces with room for it.
export function WeightIndicator({
  weight,
  bucket,
  label = false,
  className = "",
}: {
  weight?: number;
  bucket?: Bucket;
  label?: boolean;
  className?: string;
}) {
  const b: Bucket = bucket ?? (weight !== undefined ? bucketOf(weight) : "normal");
  const level = WLEVEL[b];
  const word = WFREQ[b];
  return (
    <span className={`windi ${className}`} role="img" aria-label={`Weight: ${word} (${level} of 5)`}>
      <Gauge className="windi-ic" size={13} strokeWidth={1.75} aria-hidden />
      <WeightDots level={level} />
      {label && <span className="windi-word" aria-hidden>{word}</span>}
    </span>
  );
}

// The 1-5 dot scale on its own - reused by the roomy weight control so each
// option carries the same density cue it maps to.
export function WeightDots({ level }: { level: number }) {
  return (
    <span className="wdots" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`wdot ${n <= level ? "on" : ""}`} />
      ))}
    </span>
  );
}
