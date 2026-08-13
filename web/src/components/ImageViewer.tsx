import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// ImageViewer (#149): a full-screen photo viewer for reader images. Tap an image in
// an article and it opens here, where you can double-tap (or double-click) to zoom,
// drag to pan while zoomed, and pinch to zoom on touch. A close button fades out
// after a moment and returns on any tap. When not zoomed, dragging down dismisses -
// the image follows the finger and fades as it goes.
//
// Deliberately dependency-free: pointer events cover mouse (pan + double-click) and
// touch (pan + two-finger pinch), so there's no gesture library to pull in.
export function ImageViewer({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [uiShown, setUiShown] = useState(true);
  const [pinching, setPinching] = useState(false);

  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const pan = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const lastTap = useRef(0);

  const clamp = (s: number) => Math.min(6, Math.max(1, s));

  // Auto-hide the close button after a beat of stillness; any tap brings it back.
  useEffect(() => {
    if (!uiShown) return;
    const t = window.setTimeout(() => setUiShown(false), 2600);
    return () => window.clearTimeout(t);
  }, [uiShown, scale, tx, ty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reset = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  function onPointerDown(e: ReactPointerEvent) {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* best-effort */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      pan.current = null;
      setPinching(true);
    } else if (pointers.current.size === 1) {
      pan.current = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setScale(clamp((pinch.current.scale * dist) / pinch.current.dist));
      return;
    }
    if (pan.current) {
      const dx = e.clientX - pan.current.x;
      const dy = e.clientY - pan.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) pan.current.moved = true;
      if (scale > 1) {
        setTx(pan.current.tx + dx);
        setTy(pan.current.ty + dy);
      } else {
        // Not zoomed: only vertical drag, as the pull-down-to-dismiss affordance.
        setTy(pan.current.ty + dy);
      }
    }
  }

  function onPointerUp(e: ReactPointerEvent) {
    const wasPan = pan.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) {
      pinch.current = null;
      setPinching(false);
    }
    if (pointers.current.size > 0) return;

    // All fingers up.
    if (scale <= 1.02) {
      if (wasPan && Math.abs(ty) > 110) {
        onClose();
        return;
      }
      setTy(0); // spring back from a partial pull
    }
    if (wasPan && !wasPan.moved) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        // Double tap toggles zoom.
        if (scale > 1) reset();
        else setScale(2.5);
        lastTap.current = 0;
      } else {
        lastTap.current = now;
        setUiShown((v) => !v);
      }
    }
    pan.current = null;
  }

  const dragFade = scale <= 1.02 ? Math.max(0.3, 1 - Math.abs(ty) / 320) : 1;

  // Portal to <body> so the viewer is never trapped by the reader page's transform
  // (a transformed ancestor makes position:fixed relative to it, and its stacking
  // context can bury the scrim). At the body root it reliably covers everything.
  return createPortal(
    <div
      className="imgviewer"
      role="dialog"
      aria-modal="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ background: `rgba(12, 11, 10, ${dragFade})` }}
    >
      <img
        className="imgviewer-img"
        src={src}
        alt={alt || ""}
        draggable={false}
        referrerPolicy="no-referrer"
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transition: pinching || pan.current ? "none" : "transform 0.18s ease",
        }}
      />
      <button
        className={`imgviewer-close ${uiShown ? "" : "hidden"}`}
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Close"
      >
        <X size={22} strokeWidth={2} aria-hidden />
      </button>
    </div>,
    document.body,
  );
}
