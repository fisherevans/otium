import { useState } from "react";
import {
  ARCHIVE_PRESETS,
  ARCHIVE_UNITS,
  archiveValue,
  decomposeArchive,
  isCustomArchive,
  resolveInterestArchive,
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
  interestName,
  onChange,
}: {
  scope: "source" | "interest";
  value: number; // current archive_after_days
  intDays?: number; // the interest's own value, for a source's inherit resolution
  interestName?: string;
  onChange: (days: number) => void;
}) {
  const seedDays = value > 0 ? value : scope === "source" ? resolveSourceArchive(0, intDays ?? 0, interestName).days : resolveInterestArchive(0).days;
  const seed = decomposeArchive(seedDays);
  const [showCustom, setShowCustom] = useState(isCustomArchive(value));
  const [n, setN] = useState(seed.n);
  const [unit, setUnit] = useState(seed.unit);

  const inherit = scope === "source" ? resolveSourceArchive(0, intDays ?? 0, interestName) : resolveInterestArchive(0);
  const customActive = showCustom || isCustomArchive(value);

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
    </div>
  );
}
