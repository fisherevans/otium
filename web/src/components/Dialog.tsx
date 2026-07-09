import { useEffect, type ReactNode } from "react";

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="dlg-scrim" onClick={onClose}>
      <div className="dlg" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <span className="dlg-kicker">{kicker}</span>
          <button className="dlg-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="dlg-body">{children}</div>
      </div>
    </div>
  );
}
