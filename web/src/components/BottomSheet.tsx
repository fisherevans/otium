import { useEffect, useState, type ReactNode } from "react";

// A calm, mobile-first bottom sheet in the e-ink language: a hairline-topped
// paper panel that slides up over a dim scrim, tap-scrim / Escape to dismiss.
// `variant="tall"` makes it a near-full-height reading surface (the #41 reader);
// the default is a short action sheet that hugs the bottom.
//
// The component stays mounted for the exit transition (renders while animating
// out), so callers just flip `open`.
export function BottomSheet({
  open,
  onClose,
  kicker,
  variant,
  children,
}: {
  open: boolean;
  onClose: () => void;
  kicker?: string;
  variant?: "tall";
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [up, setUp] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setUp(true));
      return () => cancelAnimationFrame(id);
    }
    setUp(false);
    const t = window.setTimeout(() => setMounted(false), 360);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className={`sheet-scrim ${up ? "up" : ""}`} onClick={onClose}>
      <div
        className={`sheet ${variant === "tall" ? "sheet-tall" : ""} ${up ? "up" : ""}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {kicker !== undefined && (
          <div className="sheet-head">
            <span className="sheet-k">{kicker}</span>
            <button className="sheet-x" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
