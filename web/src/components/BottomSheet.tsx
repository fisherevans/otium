import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

// A calm, mobile-first bottom sheet in the e-ink language: a hairline-topped
// paper panel that slides up over a dim scrim, tap-scrim / Escape to dismiss.
// `variant="tall"` makes it a near-full-height reading surface (the #41 reader);
// the default is a short action sheet that hugs the bottom.
//
// The component stays mounted for the exit transition (renders while animating
// out), so callers just flip `open`.
//
// `headActions` renders a cluster of controls in the title bar between the kicker
// and the X (#77) - the reader/player put Save/Open/overflow there so they're
// reachable without scrolling.
//
// #78: `swipeClose` enables an *interactive* drag-to-dismiss on the tall reading
// sheets (Reader/Player). The sheet follows the finger on a vertical drag and
// dismisses on release past a threshold (a real drag of the modal, not a flick).
// The grab surface is the header/handle chrome, which drags in either direction;
// a drag that begins on the scrollable body only turns into a dismiss when it
// pushes past a scroll edge (pull down at the top, push up at the bottom) so a
// normal article scroll is never hijacked. Direction is honored by `exitUp`,
// which flips the closed transform to translateY(-101%) so the panel leaves up.
export function BottomSheet({
  open,
  onClose,
  kicker,
  variant,
  swipeClose,
  headActions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  kicker?: string;
  variant?: "tall";
  swipeClose?: boolean;
  headActions?: ReactNode;
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

  // Interactive drag-to-close (#78). We track the pointer from press to release
  // and translate the sheet 1:1 with the finger once a vertical drag is
  // committed. Header/handle grabs drag in either direction; a body-origin drag
  // only becomes a dismiss when it overscrolls past an edge (so mid-article
  // scrolls are left alone). No preventDefault: header chrome sets touch-action:
  // none, and at a body scroll edge there's nothing to scroll.
  const CLOSE_DIST = 96; // px of drag past which release dismisses
  const drag = useRef<{
    startY: number;
    startX: number;
    fromHeader: boolean;
    atTop: boolean;
    atBottom: boolean;
    active: boolean;
    captured: boolean;
    pointerId: number;
  } | null>(null);

  function scroller() {
    return sheetRef.current?.querySelector<HTMLElement>(".reader, .src-detail, .src-items") ?? null;
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (!swipeClose) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const t = e.target as Element;
    const fromHeader = !!t.closest(".sheet-head, .sheet-handle");
    const sc = scroller();
    drag.current = {
      startY: e.clientY,
      startX: e.clientX,
      fromHeader,
      atTop: !sc || sc.scrollTop <= 0,
      atBottom: !sc || sc.scrollHeight - sc.clientHeight - sc.scrollTop <= 1,
      active: false,
      captured: false,
      pointerId: e.pointerId,
    };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    const dx = e.clientX - d.startX;
    if (!d.active) {
      // Wait for a clear vertical intent; abandon on a dominant horizontal move
      // (that's a swipe/scroll, not a dismiss).
      if (Math.abs(dy) < 8 || Math.abs(dy) <= Math.abs(dx)) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) drag.current = null;
        return;
      }
      const canDrag = d.fromHeader || (dy > 0 && d.atTop) || (dy < 0 && d.atBottom);
      if (!canDrag) {
        drag.current = null; // it's a real body scroll - let it be
        return;
      }
      d.active = true;
    }
    if (!d.captured) {
      try {
        sheetRef.current?.setPointerCapture(d.pointerId);
      } catch {
        /* pointer capture is best-effort */
      }
      d.captured = true;
    }
    const el = sheetRef.current;
    if (el) {
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
    }
  }

  function onPointerUp(e: ReactPointerEvent) {
    const d = drag.current;
    drag.current = null;
    const el = sheetRef.current;
    if (!d || !d.active || !el) return;
    const dy = e.clientY - d.startY;
    el.style.transition = ""; // hand motion back to the CSS transition
    if (dy >= CLOSE_DIST) {
      el.style.transform = "";
      onClose(); // dragged down past threshold → leave downward (default)
    } else if (dy <= -CLOSE_DIST) {
      el.style.transform = "";
      setExitUp(true);
      onClose(); // dragged up past threshold → leave upward
    } else {
      // Under threshold: snap back. rAF so the transition picks up from the
      // dragged offset rather than jumping.
      requestAnimationFrame(() => {
        if (sheetRef.current) sheetRef.current.style.transform = "";
      });
    }
  }

  function onPointerCancel() {
    const el = sheetRef.current;
    if (drag.current?.active && el) {
      el.style.transition = "";
      requestAnimationFrame(() => {
        if (sheetRef.current) sheetRef.current.style.transform = "";
      });
    }
    drag.current = null;
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
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {swipeClose && <div className="sheet-handle" aria-hidden />}
        {kicker !== undefined && (
          <div className="sheet-head">
            <span className="sheet-k">{kicker}</span>
            {headActions}
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
