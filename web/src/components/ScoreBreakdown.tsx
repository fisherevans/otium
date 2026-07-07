import type { PointerEvent as ReactPointerEvent } from "react";
import { type ScoreBreakdown, type Selected } from "@/api/client";
import { BottomSheet } from "./BottomSheet";

// Score transparency (#18/#40). Two read-only surfaces that make the card's
// one-line reason legible as the actual ranker math:
//   - ScoreCue: a quiet hairline strength meter on the card, sized to the item's
//     rank score relative to the session's strongest. Tap to open the breakdown.
//   - ScoreBreakdownSheet: the per-factor decomposition - each multiplicative
//     contribution the ranker used, as a calm row with a plain-language line,
//     ending on the net effective score.
// Neither emits an engagement event: viewing why an item ranked is orientation,
// not a signal (explicit-signals-only, EXPERIENCE.md principle 3).

const r2 = (n: number) => Math.round(n * 100) / 100;
const mult = (n: number) => `×${r2(n)}`;

// cadenceLabel turns posts/day into the human phrase the rarity line reads with.
function cadenceLabel(perDay: number): string {
  if (perDay <= 0) return "rarely";
  if (perDay >= 1) return `~${Math.round(perDay * 10) / 10}×/day`;
  const perWeek = perDay * 7;
  if (perWeek >= 1) return `~${Math.round(perWeek)}×/week`;
  const perMonth = perDay * 30;
  return `~${Math.max(1, Math.round(perMonth))}×/month`;
}

function ageLabel(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${Math.round(days)}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function freshWord(f: number): string {
  if (f > 0.7) return "fresh";
  if (f > 0.4) return "still recent";
  if (f > 0.15) return "aging";
  return "old";
}

function weightLine(w: number): string {
  if (w >= 5) return "A favorite source - weighted up";
  if (w >= 2) return "You weight this source high";
  if (w > 1) return "You weight this source above normal";
  if (w >= 1) return "Standard weight";
  if (w > 0.25) return "You've down-weighted this source";
  return "Strongly down-weighted";
}

type Factor = {
  name: string;
  mult: string;
  fill: number; // 0..1, where more fill = a stronger contribution
  line: string;
};

// factorsOf maps the raw breakdown into the three display rows. Each fill is the
// factor's position in its own plausible range, so a fuller bar always means "this
// pushed the item up" regardless of which factor it is.
function factorsOf(b: ScoreBreakdown): Factor[] {
  // Rarity is population-relative now (#110): the boost reflects where this
  // source's posting cadence ranks among your other sources, not an absolute
  // rate. Translate the multiplier back into that plain-language rank.
  const rareShare = Math.round(Math.min(1, Math.max(0, b.rarity - 1)) * 100);
  let rarityLine: string;
  if (b.rarity <= 1.05) {
    rarityLine = `Posts ${cadenceLabel(b.cadence_per_day)} - among your more frequent sources, no boost`;
  } else if (b.rarity >= 1.66) {
    rarityLine = `Posts ${cadenceLabel(b.cadence_per_day)} - rarer than most of your sources → boosted`;
  } else {
    rarityLine = `Posts ${cadenceLabel(b.cadence_per_day)} - rarer than ~${rareShare}% of your sources → lifted`;
  }

  return [
    {
      name: "Weight",
      mult: mult(b.weight),
      fill: Math.min(1, b.weight / 5),
      line: weightLine(b.weight),
    },
    {
      name: "Rarity",
      mult: mult(b.rarity),
      fill: Math.min(1, b.rarity - 1), // rareBoostMax = 1, so (rarity-1) is already 0..1
      line: rarityLine,
    },
    {
      name: "Freshness",
      mult: mult(b.freshness),
      fill: Math.min(1, b.freshness),
      line: `Published ${ageLabel(b.age_days)} → ${freshWord(b.freshness)}`,
    },
  ];
}

// ScoreCue is the quiet on-card strength indicator: a hairline meter filled to the
// item's rank score relative to the session's strongest item. maxScore is the top
// score in the loaded queue (the metric items were actually ranked by), so the
// cue honestly answers "how strongly did this rank." Tap opens the breakdown.
export function ScoreCue({ sel, maxScore, onOpen }: { sel: Selected; maxScore: number; onOpen: () => void }) {
  const strength = maxScore > 0 ? Math.max(0.06, Math.min(1, sel.score / maxScore)) : 0;
  return (
    <button
      className="score-cue"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
      aria-label="Why this item? Score breakdown"
      title="Why this item?"
    >
      <span className="score-cue-track">
        <span className="score-cue-fill" style={{ width: `${strength * 100}%` }} />
      </span>
    </button>
  );
}

export function ScoreBreakdownSheet({ sel, open, onClose }: { sel: Selected | null; open: boolean; onClose: () => void }) {
  const b = sel?.breakdown;
  return (
    <BottomSheet open={open && !!b} onClose={onClose} kicker="Why this item?">
      {sel && b && (
        <>
          <div className="bd-title">{sel.item.title}</div>
          <div className="bd-rows">
            {factorsOf(b).map((f) => (
              <div className="bd-row" key={f.name}>
                <div className="bd-row-head">
                  <span className="bd-name">{f.name}</span>
                  <span className="bd-mult">{f.mult}</span>
                </div>
                <div className="bd-bar">
                  <div className="bd-fill" style={{ width: `${f.fill * 100}%` }} />
                </div>
                <div className="bd-line">{f.line}</div>
              </div>
            ))}
          </div>
          <div className="bd-net">
            <span className="bd-net-label">Effective score</span>
            <span className="bd-net-val">{b.effective_score.toFixed(2)}</span>
          </div>
          <p className="bd-summary">The factors above multiply to that score. In short: {sel.reason.toLowerCase()}.</p>
        </>
      )}
    </BottomSheet>
  );
}
