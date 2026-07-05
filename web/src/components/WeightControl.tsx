import { BUCKETS, WFREQ, WHINT, WLEVEL, type Bucket } from "@/lib/weight";
import { WeightDots } from "./WeightIndicator";

// #93: the source-config weight control. Fisher's note: the old cramped
// horizontal buckets (v.low/low/normal/high/fav) truncated and read as
// placeholder - "words if the UX gives it enough room". This gives the words
// room: a vertical radio list, one frequency word per row with a short hint and
// its matching 1-5 dot density, so nothing truncates and the scale is legible.
// Highest frequency on top so the dot density reads as a gradient down the list.
//
// Shared by every surface that *edits* weight (source page, library drill-in,
// quick-weight sheet) so they stay identical. Weight values / API are unchanged;
// this is presentation only.
export function WeightControl({
  value,
  onChange,
}: {
  value: Bucket;
  onChange: (b: Bucket) => void;
}) {
  return (
    <div className="wctl" role="radiogroup" aria-label="Weight">
      {[...BUCKETS].reverse().map((b) => (
        <button
          key={b}
          type="button"
          role="radio"
          aria-checked={value === b}
          className={`wchoice ${value === b ? "on" : ""}`}
          onClick={() => onChange(b)}
        >
          <span className="wchoice-main">
            <span className="wchoice-word">{WFREQ[b]}</span>
            <span className="wchoice-hint">{WHINT[b]}</span>
          </span>
          <WeightDots level={WLEVEL[b]} />
        </button>
      ))}
    </div>
  );
}
