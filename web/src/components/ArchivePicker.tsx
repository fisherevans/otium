import { BottomSheet } from "./BottomSheet";
import { ARCHIVE_PRESETS, type ArchiveScope } from "@/lib/archive";

// The archival-period modal (#115). A short action sheet listing the fixed
// windows plus the scope-appropriate "inherit" option (an interest inherits the
// global default; a source inherits its interest). Used by both the interest page
// and the source page so the options and copy never drift. Picking closes the
// sheet; the caller persists via api.updateInterest / api.updateSource.
export function ArchivePicker({
  open,
  onClose,
  value,
  scope,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  value: number;
  scope: ArchiveScope;
  onPick: (days: number) => void;
}) {
  function choose(days: number) {
    onPick(days);
    onClose();
  }
  return (
    <BottomSheet open={open} onClose={onClose} kicker="Archival period">
      <div className="sheet-title">
        {scope === "interest" ? "Default archival period" : "Archive articles after"}
      </div>
      <div className="sheet-rows">
        <button className="sheet-row" onClick={() => choose(0)}>
          <span>{scope === "interest" ? "Global default" : "Inherit from interest"}</span>
          {value === 0 && <span className="sheet-chev" aria-hidden>✓</span>}
        </button>
        {ARCHIVE_PRESETS.map((p) => (
          <button key={p.days} className="sheet-row" onClick={() => choose(p.days)}>
            <span>{p.label}</span>
            {value === p.days && <span className="sheet-chev" aria-hidden>✓</span>}
          </button>
        ))}
      </div>
      <p className="caphint" style={{ marginTop: 12 }}>
        Articles older than this stop appearing in sessions. "Never" keeps them evergreen.
      </p>
    </BottomSheet>
  );
}
