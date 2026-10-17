import { X } from "lucide-react";
import { type ReactNode } from "react";
import { Overlay } from "./Overlay";

// A calm centered dialog in the e-ink language: a hairline-bordered paper card
// centered over a dim scrim, click-away / Escape / X to dismiss. This is the
// deliberate edit surface for the management pages (#120) - rename, choose an
// archival period, edit keywords, move to a section, change a source's topic.
// The pages themselves stay read-only; editing is an explicit, focused act.
export function Dialog({
  open,
  onClose,
  kicker,
  children,
}: {
  open: boolean;
  onClose: () => void;
  kicker?: string;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <Overlay label={kicker || "Edit details"} onClose={onClose}>
    <div className="dlg-scrim" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <span className="dlg-kicker">{kicker}</span>
          <button className="dlg-x" onClick={onClose} aria-label="Close">
            <X size={22} className="inline-icon" aria-hidden />
          </button>
        </div>
        <div className="dlg-body">{children}</div>
      </div>
    </div>
    </Overlay>
  );
}
