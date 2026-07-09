import { useState } from "react";
import {
  ARCHIVE_PRESETS,
  ARCHIVE_UNITS,
  archiveValue,
  decomposeArchive,
  isCustomArchive,
  resolveTopicArchive,
  resolveSourceArchive,
} from "@/lib/archive";

// The archive-after chooser used inside the management dialogs (#120). Renders in
// the shared .dlg-opts radio style: the scope's Inherit option (which names BOTH
// where the value comes from AND the resolved value), the quick presets, and a
// Custom option that expands to a number + unit picker plus a None (never-archive)
// choice. Stores everything as archive_after_days: 0 = inherit, -1 = none, N = days.
export function ArchiveChoice({
  scope,
  value,
  intDays,
  topicName,
  onChange,
  keepCount,
  combine,
  onKeepCount,
  onCombine,
}: {
  scope: "source" | "topic";
  value: number; // current archive_after_days
  intDays?: number; // the topic's own value, for a source's inherit resolution
  topicName?: string;
  onChange: (days: number) => void;
  // Source-only rule-based archive (#124): keep-latest-N count + how it combines
  // with the age window. Rendered only when onKeepCount is supplied.
  keepCount?: number;
  combine?: string;
  onKeepCount?: (n: number) => void;
  onCombine?: (c: "and" | "or") => void;
}) {
  const seedDays = value > 0 ? value : scope === "source" ? resolveSourceArchive(0, intDays ?? 0, topicName).days : resolveTopicArchive(0).days;
  const seed = decomposeArchive(seedDays);
  const [showCustom, setShowCustom] = useState(isCustomArchive(value));
  const [n, setN] = useState(seed.n);
  const [unit, setUnit] = useState(seed.unit);

  const inherit = scope === "source" ? resolveSourceArchive(0, intDays ?? 0, topicName) : resolveTopicArchive(0);
  const customActive = showCustom || isCustomArchive(value);
  // The age rule is active (and the AND/OR combine matters) unless it resolves to
  // evergreen - then only the count rule limits what's on deck.
  const ageActive = resolveSourceArchive(value, intDays ?? 0, topicName).days !== -1;

  function unitDays(u: string): number {
    return ARCHIVE_UNITS.find((x) => x.key === u)?.days ?? 1;
  }
  function commitCustom(nn: number, uu: string) {
    onChange(Math.max(1, Math.round(nn)) * unitDays(uu));
  }
  function openCustom() {
    setShowCustom(true);
    if (!isCustomArchive(value)) {
      // Switching to custom keeps the current duration; seed the form from it.
      const d = decomposeArchive(seedDays);
      setN(d.n);
      setUnit(d.unit);
      commitCustom(d.n, d.unit);
    }
  }

  return (
    <div className="dlg-opts">
      <button className={`dlg-opt ${value === 0 ? "on" : ""}`} onClick={() => (setShowCustom(false), onChange(0))}>
        <span className="dlg-radio" aria-hidden />
        <span className="dlg-name">Inherit</span>
        <span className="dlg-sub">
          {inherit.originLabel} · {inherit.value}
        </span>
      </button>

      {ARCHIVE_PRESETS.map((p) => (
        <button
          key={p.days}
          className={`dlg-opt ${value === p.days && !customActive ? "on" : ""}`}
          onClick={() => (setShowCustom(false), onChange(p.days))}
        >
          <span className="dlg-radio" aria-hidden />
          <span className="dlg-name">{p.label}</span>
        </button>
      ))}

      <button className={`dlg-opt ${customActive ? "on" : ""}`} onClick={openCustom}>
        <span className="dlg-radio" aria-hidden />
        <span className="dlg-name">Custom</span>
        {isCustomArchive(value) && <span className="dlg-sub">{value === -1 ? "never archive" : archiveValue(value)}</span>}
      </button>

      {customActive && (
        <div className="arch-custom">
          <div className="arch-custom-row">
            <input
              className="arch-num"
              type="number"
              min={1}
              value={n}
              onChange={(e) => {
                const v = Math.max(1, Number(e.target.value) || 1);
                setN(v);
                commitCustom(v, unit);
              }}
            />
            <select
              className="arch-unit"
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
                commitCustom(n, e.target.value);
              }}
            >
              {ARCHIVE_UNITS.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                  {n > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </div>
          <button className={`dlg-opt ${value === -1 ? "on" : ""}`} onClick={() => onChange(-1)}>
            <span className="dlg-radio" aria-hidden />
            <span className="dlg-name">None</span>
            <span className="dlg-sub">never auto-archive</span>
          </button>
        </div>
      )}

      {onKeepCount && (
        <div className="arch-rule">
          <div className="arch-rule-row">
            <span className="dlg-name">Keep latest</span>
            <input
              className="arch-num"
              type="number"
              min={0}
              value={keepCount ?? 0}
              onChange={(e) => onKeepCount(Math.max(0, Math.round(Number(e.target.value) || 0)))}
            />
            <span className="dlg-sub">{(keepCount ?? 0) === 0 ? "no count limit" : "on deck"}</span>
          </div>
          {ageActive && (keepCount ?? 0) > 0 && onCombine && (
            <div className="arch-combine">
              {(["and", "or"] as const).map((c) => (
                <button key={c} className={`arch-comb ${(combine ?? "and") === c ? "on" : ""}`} onClick={() => onCombine(c)}>
                  {c === "and" ? "within age AND latest N" : "within age OR latest N"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
