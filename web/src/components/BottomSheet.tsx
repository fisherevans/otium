import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

// A calm, mobile-first bottom sheet in the e-ink language: a hairline-topped
// paper panel that slides up over a dim scrim, tap-scrim / Escape to dismiss.
// `variant="tall"` makes it a near-full-height reading surface (the #41 reader);
// the default is a short action sheet that hugs the bottom.
//
// The component stays mounted for the exit transition (renders while animating
// out), so callers just flip `open`.
//
// #74: `swipeClose` enables an overscroll-style swipe-to-dismiss on the tall
// reading sheets (Reader/Player). It only engages at the content's scroll edges
// so it never steals a normal scroll: pulling DOWN when already at the top
// dismisses and animates the sheet down; pushing UP when already at the bottom
// dismisses and animates it up. Direction is honored by `exitUp`, which flips the
// closed transform to translateY(-101%) so the panel leaves upward.
export function BottomSheet({
  open,
  onClose,
  kicker,
  variant,
  swipeClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  kicker?: string;
  variant?: "tall";
  swipeClose?: boolean;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [up, setUp] = useState(false);
  const [exitUp, setExitUp] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setExitUp(false); // a fresh open always enters (and by default leaves) downward
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

  // Swipe-to-dismiss (#74). We read the scroller's edge state at press time and
  // only treat the gesture as a dismiss when it pushes past that edge - so a
  // scroll within the content is never hijacked. No preventDefault: at an edge
  // there's nothing to scroll, so pointerup (not pointercancel) fires.
  const drag = useRef<{ y: number; x: number; atTop: boolean; atBottom: boolean } | null>(null);
  const SWIPE_DIST = 72; // px of vertical overscroll travel to dismiss

  function onPointerDown(e: ReactPointerEvent) {
    if (!swipeClose) return;
    const sc = sheetRef.current?.querySelector<HTMLElement>(".reader") ?? null;
    const atTop = !sc || sc.scrollTop <= 0;
    const atBottom = !sc || sc.scrollHeight - sc.clientHeight - sc.scrollTop <= 1;
    drag.current = { y: e.clientY, x: e.clientX, atTop, atBottom };
  }
  function onPointerUp(e: ReactPointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dy = e.clientY - d.y;
    const dx = e.clientX - d.x;
    if (Math.abs(dy) < Math.abs(dx)) return; // horizontal gesture, not a dismiss
    if (dy >= SWIPE_DIST && d.atTop) {
      onClose(); // pulled down from the top → leave downward (default)
    } else if (dy <= -SWIPE_DIST && d.atBottom) {
      setExitUp(true); // pushed up from the bottom → leave upward
      onClose();
    }
  }

  if (!mounted) return null;

  return (
    <div className={`sheet-scrim ${up ? "up" : ""}`} onClick={onClose}>
      <div
        ref={sheetRef}
        className={`sheet ${variant === "tall" ? "sheet-tall" : ""} ${up ? "up" : ""} ${exitUp ? "exit-up" : ""}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
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
