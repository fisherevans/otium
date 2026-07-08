import { BUCKETS, REP_FREQ, REP_HINT, type Bucket } from "@/lib/represent";
import { RepDots } from "./RepDots";

// The representation editing control (#93/#120): a vertical radio list, one
// frequency word per row with a short hint and its matching 1-5 dot density, so
// nothing truncates and the scale reads as a gradient. Highest frequency on top.
// Shared by every surface that *edits* representation so they stay identical.
export function RepresentationControl({
  value,
  onChange,
}: {
  value: Bucket;
  onChange: (b: Bucket) => void;
}) {
  return (
    <div className="repctl" role="radiogroup" aria-label="Representation">
      {[...BUCKETS].reverse().map((b) => (
        <button
          key={b}
          type="button"
          role="radio"
          aria-checked={value === b}
          className={`repchoice ${value === b ? "on" : ""}`}
          onClick={() => onChange(b)}
        >
          <span className="repchoice-main">
            <span className="repchoice-word">{REP_FREQ[b]}</span>
            <span className="repchoice-hint">{REP_HINT[b]}</span>
          </span>
          <RepDots bucket={b} />
        </button>
      ))}
    </div>
  );
}
