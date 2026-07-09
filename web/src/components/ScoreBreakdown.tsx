import { type Selected } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { bucketOf, REP_FREQ, REP_PROSE } from "@/lib/represent";
import { RepDots } from "./RepDots";

// Why-this transparency (#18/#40/#120). The engine works in TWO steps and this
// sheet keeps them separate rather than conflating everything into one multiplied
// score: (1) which SOURCE got picked - driven by its representation; (2) which
// ARTICLE within that source - ranked by the article score, which today is
// recency (freshness) alone. More article-score signals (view count, length,
// keyword boosts) will slot into step 2 later. Viewing this emits no engagement
// event: it's orientation, not a signal.

function ageLabel(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${Math.round(days)} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function freshWord(f: number): string {
  if (f > 0.7) return "very fresh";
  if (f > 0.4) return "still recent";
  if (f > 0.15) return "aging";
  return "old";
}

export function ScoreBreakdownSheet({ sel, open, onClose }: { sel: Selected | null; open: boolean; onClose: () => void }) {
  const b = sel?.breakdown;
  const bucket = b ? bucketOf(b.weight) : "normal";
  const fresh = b?.freshness ?? 0;
  return (
    <BottomSheet open={open && !!b} onClose={onClose} kicker="Why this?">
      {sel && b && (
        <>
          <div className="bd-title">{sel.item.title}</div>

          <div className="bd-step">
            <span className="bd-step-num">1</span>
            <div className="bd-step-body">
              <div className="bd-step-head">Why this source?</div>
              <p className="bd-step-line">
                {sel.source_title} was picked from your section, then its freshest article was taken. It's set to{" "}
                <b>{REP_FREQ[bucket]}</b> representation - {REP_PROSE[bucket]}.
              </p>
              <div className="bd-rep">
                <RepDots bucket={bucket} />
              </div>
            </div>
          </div>

          <div className="bd-step">
            <span className="bd-step-num">2</span>
            <div className="bd-step-body">
              <div className="bd-step-head">Why this article?</div>
              <p className="bd-step-line">
                Within {sel.source_title}, articles rank by recency. This one was published{" "}
                <b>{ageLabel(b.age_days)}</b> - {freshWord(fresh)}.
              </p>
              <div className="bd-bar">
                <div className="bd-fill" style={{ width: `${Math.round(Math.min(1, fresh) * 100)}%` }} />
              </div>
              <div className="bd-score">
                <span className="bd-score-label">Article score</span>
                <span className="bd-score-val">{fresh.toFixed(2)}</span>
              </div>
              <p className="bd-note">
                Recency is the only article-score signal today. More are coming - view count, length, and keyword boosts.
              </p>
            </div>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
