import { BUCKETS, REP_FREQ, REP_HINT, type Bucket } from "@/lib/represent";

// A compact representation control (#129): a single segmented row (Least … Most)
// plus one hint line for the selected level, instead of five tall radio rows that
// dominated the modal. Shared by the source-page feed controls and the add-source
// wizard so the vocabulary and layout stay identical.
export function RepresentationPicker({ value, onChange }: { value: Bucket; onChange: (b: Bucket) => void }) {
  return (
    <div className="rep-picker">
      <div className="rep-scale">
        {BUCKETS.map((b) => (
          <button key={b} className={`rep-seg ${value === b ? "on" : ""}`} onClick={() => onChange(b)}>
            {REP_FREQ[b]}
          </button>
        ))}
      </div>
      <div className="rep-picker-hint">{REP_HINT[value]}</div>
    </div>
  );
}
