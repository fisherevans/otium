import { REP_LEVEL, type Bucket } from "@/lib/represent";

// The 1-5 representation dot scale, keyed by bucket, in the management-page style
// (.rep-dots). One component so the source page, interest page, and the in-session
// ··· menu all render representation identically (#120).
export function RepDots({ bucket }: { bucket: Bucket }) {
  const level = REP_LEVEL[bucket];
  return (
    <span className="rep-dots" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`rep-dot ${n <= level ? "on" : ""}`} />
      ))}
    </span>
  );
}
