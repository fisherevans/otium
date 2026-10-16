import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent, type SyntheticEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ExternalLink, Bookmark } from "lucide-react";
import { api, type Item, type ItemContent } from "@/api/client";
import { renderSummary } from "@/lib/html";
import { fmtDate, readTime, authorRedundant } from "@/lib/format";
import { ShareActions } from "./ReaderActions";
import { ImageViewer } from "./ImageViewer";
import { Overlay, usePresence } from "./Overlay";

// Shared full-page article reader. Overlay owns its history entry so each
// origin keeps its own list, selection, and scroll position.
//
// It loads the reader body lazily via GET /items/{id}/content (#98/#99), so a
// teaser-only topic gets its readability-extracted full text on demand. When a
// prefetched payload is handed in (the card already fetched it to pick its
// callout), we skip the round-trip. A thin always-visible progress bar (#87)
// tracks scroll; a read-time estimate (#88) sits in the header; Copy link +
// Share are prominent, not buried (#92).

type Body = { html: string; words: number } | null;

function bodyFrom(raw: string | undefined): Body {
  const r = renderSummary(raw);
  if (r.empty) return null;
  const text = new DOMParser().parseFromString(r.html, "text/html").body.textContent ?? "";
  return { html: r.html, words: text.trim().split(/\s+/).filter(Boolean).length };
}

export function ReaderPage({
  item: currentItem,
  sourceTitle,
  preloaded,
  open,
  onClose,
  onOpen,
  onSave,
  onNext,
}: {
  item: Item | null;
  sourceTitle?: string;
  preloaded?: ItemContent | null;
  open: boolean;
  onClose: () => void;
  onOpen: () => void; // open the original externally
  onSave?: () => void;
  onNext?: () => void; // #149: swipe up at the bottom -> advance the feed, close the reader
}) {
  const previousItem = useRef(currentItem);
  if (currentItem) previousItem.current = currentItem;
  const item = currentItem ?? previousItem.current;
  const { mounted, visible: inView } = usePresence(open);
  const [drag, setDrag] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    setDrag(null);
    setDragging(false);
    if (open) setAdvanced(false);
  }, [open]);

  const [state, setState] = useState<"loading" | "ready" | "external">("loading");
  const [body, setBody] = useState<Body>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState(0);
  // #102: reveal-on-scroll-up condensed header. Hidden while reading down;
  // scrolling up (to look for context) slides a title+date bar in; scrolling
  // back down hides it. Near the very top it stays hidden (the real title is
  // right there in the body). lastY tracks direction.
  const [revealed, setRevealed] = useState(false);
  const lastY = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemId = item?.id ?? 0;

  // Load the reader body when the page opens (or the item changes). Prefer the
  // server's extracted content; fall back to the item's ingest body, then its
  // summary. Anything non-empty renders; only a truly empty result -> external.
  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    setState("loading");
    setLoadError(false);
    setBody(null);
    setProgress(0);
    setRevealed(false);
    lastY.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    const decide = (content: ItemContent | null) => {
      if (cancelled) return;
      const raw = content?.content?.trim()
        ? content.content
        : item.content?.trim()
          ? item.content
          : item.summary;
      const b = bodyFrom(raw);
      if (!b) {
        setState("external");
        return;
      }
      setBody(b);
      setState("ready");
    };

    if (preloaded) {
      decide(preloaded);
    } else {
      api
        .itemContent(item.id)
        .then(decide)
        .catch(() => {
          if (cancelled) return;
          setLoadError(true);
          decide(null);
        });
    }
    return () => {
      cancelled = true;
    };
    // Key on the item's identity, NOT the item/preloaded object refs (#142): the
    // parent re-renders every second (the session's elapsed ticker) with fresh
    // refs, and depending on them re-ran this effect ~1/s, re-setting the body -
    // which re-parsed the HTML and reloaded the images (the "flickering"). An
    // item's content is stable for a given id, so `open` + `itemId` is enough; the
    // closure captures the current item/preloaded when the id actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemId, attempt]);

  // Desktop keyboard controls (#4): backspace/escape closes back to the card,
  // space / arrows page the article. Active only while the reader is open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (e.defaultPrevented || !target.closest(".readerpage") || target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === " " && target.closest("button, a")) return;
      const el = scrollRef.current;
      switch (e.key) {
        case "Backspace":
          e.preventDefault();
          onClose();
          break;
        case " ":
        case "ArrowDown":
        case "PageDown":
          if (el) {
            e.preventDefault();
            el.scrollBy({ top: el.clientHeight * 0.85 });
          }
          break;
        case "ArrowUp":
        case "PageUp":
          if (el) {
            e.preventDefault();
            el.scrollBy({ top: -el.clientHeight * 0.85 });
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Swipe right anywhere to go back to the feed (#120, hardened #142). The old
  // version was flaky: any early vertical drift permanently killed the gesture
  // (start=null), so a swipe that dipped a few pixels down first - common while
  // reading - simply didn't register, forcing the back button. And with no
  // pointer capture, a drag that left the element lost its release on desktop.
  //
  // Now the axis is decided ONCE, when travel first crosses a small slop, by
  // whichever axis dominates - and it sticks for the rest of the gesture. A
  // rightward-dominant move locks into "swipe" (and captures the pointer so the
  // rest of the drag can't be lost); a vertical-dominant move locks into "scroll"
  // and we never touch it, so native scrolling is untouched. touch-action:pan-y
  // (CSS) still lets vertical panning through.
  const start = useRef<{ id: number; x: number; y: number; atBottom: boolean } | null>(null);
  const pointers = useRef(new Set<number>());
  const mode = useRef<"undecided" | "swipe" | "scroll">("undecided");
  const SLOP = 8; // px of travel before we commit to an axis
  const NEXT_SWIPE = 70; // px of upward travel at the bottom that advances the feed (#149)
  // #149: at the very bottom there's nothing left to scroll, so an upward flick is
  // the natural "next" gesture - it advances the feed and closes the reader, saving
  // the back-then-swipe two-step. Only armed when the gesture STARTS at the bottom,
  // so a normal upward scroll mid-article never triggers it.
  function atBottom() {
    const el = scrollRef.current;
    if (!el) return false;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
  }
  function cancelGesture() {
    start.current = null;
    mode.current = "undecided";
    setDrag(null);
    setDragging(false);
  }
  function onPointerDown(e: ReactPointerEvent) {
    pointers.current.add(e.pointerId);
    if (pointers.current.size !== 1 || !e.isPrimary || (window.visualViewport?.scale ?? 1) > 1.05) {
      cancelGesture();
      return;
    }
    if (e.button !== 0 || (e.target as Element).closest("button, a, input, textarea, select, iframe, audio, video")) return;
    start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, atBottom: atBottom() };
    mode.current = "undecided";
  }
  function onPointerMove(e: ReactPointerEvent) {
    const s = start.current;
    if (!s || s.id !== e.pointerId || pointers.current.size !== 1 || mode.current === "scroll") return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (mode.current === "undecided") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return; // not enough travel yet
      // Commit to the dominant axis. Rightward + horizontal-dominant is a back
      // swipe; anything else is a scroll we leave alone.
      if (dx > 0 && Math.abs(dx) >= Math.abs(dy)) {
        mode.current = "swipe";
        setDragging(true);
        try {
          e.currentTarget.setPointerCapture(e.pointerId); // don't lose the release
        } catch {
          /* capture is best-effort */
        }
      } else {
        mode.current = "scroll";
        return;
      }
    }
    if (mode.current === "swipe") setDrag(Math.max(0, dx));
  }
  function onPointerUp(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const wasSwiping = mode.current === "swipe";
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    cancelGesture();
    if (wasSwiping) {
      if (dx > 90) onClose();
      return;
    }
    if (s.atBottom && onNext && atBottom() && dy <= -NEXT_SWIPE && Math.abs(dy) > Math.abs(dx)) {
      // Only the feed moves when advancing; avoid a competing reader exit.
      setAdvanced(true);
      onNext();
    }
  }
  function onPointerCancel(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
    cancelGesture();
  }

  const readEst = useMemo(() => (body ? readTime(body.html.replace(/<[^>]+>/g, " ")) : ""), [body]);

  // #149: tapping an image in the article opens the full-screen zoomable viewer.
  // The body is dangerouslySetInnerHTML, so we catch the click on the container and
  // check the target. Stable (useCallback) so the memoized article element below
  // keeps its reference and the flicker fix holds.
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  useEffect(() => { if (!open) setViewerSrc(null); }, [open]);
  const onBodyClick = useCallback((e: ReactMouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "IMG") {
      const src = (t as HTMLImageElement).currentSrc || (t as HTMLImageElement).src;
      if (src) {
        e.preventDefault();
        setViewerSrc(src);
      }
    }
  }, []);

  const onBodyError = useCallback((event: SyntheticEvent<HTMLDivElement>) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || image.dataset.loadFailed) return;
    image.dataset.loadFailed = "true";
    const caption = document.createElement("span");
    caption.className = "reader-image-unavailable";
    caption.textContent = image.alt ? `Image unavailable: ${image.alt}` : "Image unavailable.";
    image.insertAdjacentElement("afterend", caption);
  }, []);

  // Memoize the article element itself, keyed only on the HTML string (#149). The
  // parent (SessionPage) re-renders every second for its active-time ticker, which
  // cascades a ReaderPage re-render each second. React re-commits
  // dangerouslySetInnerHTML on every such render - blowing away and re-inserting
  // the whole parsed subtree, which forces every <img> to reload (the "flicker" +
  // content bounce). Returning a referentially-stable element while the body HTML
  // is unchanged makes React skip that subtree entirely, so images load once and
  // stay put. (The earlier #142 fix stopped the body from being *re-parsed*; this
  // stops it from being re-*committed*.)
  const articleBody = useMemo(
    () => <div className="reader-body" onClick={onBodyClick} onErrorCapture={onBodyError} dangerouslySetInnerHTML={{ __html: body?.html ?? "" }} />,
    [body?.html, onBodyClick, onBodyError],
  );

  function onScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const y = el.scrollTop;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(1, Math.max(0, y / max)) : 0);
    // Reveal the condensed header only when scrolling UP, and only once the real
    // in-body title has scrolled away. Near the top, keep it hidden.
    const dy = y - lastY.current;
    if (y < 140) setRevealed(false);
    else if (dy < -6) setRevealed(true);
    else if (dy > 6) setRevealed(false);
    lastY.current = y;
  }

  if (!mounted || !item || advanced) return null;

  return (
    <Overlay active={open} label={item.title} onClose={onClose}>
    <div
      className={`readerpage ${inView ? "in" : ""} ${dragging ? "dragging" : ""}`}
      style={drag != null ? { transform: `translateX(${drag}px)` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="rp-topbar">
        <div className="readerpage-head">
        <button className="rp-back" onClick={onClose} aria-label="Back">
          <ChevronLeft size={20} strokeWidth={1.9} aria-hidden />
        </button>
        {readEst && <span className="rp-readtime">{readEst}</span>}
        <div className="rp-actions">
          {onSave && (
            <button className="rp-act" onClick={onSave} aria-label="Save">
              <Bookmark size={18} strokeWidth={1.75} aria-hidden />
            </button>
          )}
          <button className="rp-act" onClick={onOpen} aria-label="Open original">
            <ExternalLink size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <ShareActions item={item} />
        </div>
        </div>
        <div className={`rp-revealbar ${revealed ? "in" : ""}`} aria-hidden={!revealed}>
          <span className="rp-reveal-title">{item.title}</span>
          {item.published_at && <span className="rp-reveal-date">{fmtDate(item.published_at)}</span>}
        </div>
      </div>

      <div className="readerpage-body" ref={scrollRef} onScroll={onScroll}>
        <h1 className="rp-title">{item.title}</h1>
        <div className="rp-meta">
          {(() => {
            // #2: omit the author when it just repeats the source.
            const showAuthor = !!item.author && !authorRedundant(item.author, sourceTitle);
            return (
              <>
                {sourceTitle && <span>{sourceTitle}</span>}
                {sourceTitle && showAuthor && <span aria-hidden>·</span>}
                {showAuthor && <span>{item.author}</span>}
                {(sourceTitle || showAuthor) && item.published_at && <span aria-hidden>·</span>}
                {item.published_at && <span>{fmtDate(item.published_at)}</span>}
              </>
            );
          })()}
        </div>

        {loadError && (
          <div className="rp-load-error" role="status">
            <p>{body ? "The full text could not load. Showing the available text." : "The full text could not load."}</p>
            <button className="btn ghost" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
          </div>
        )}
        {state === "loading" ? (
          <div className="rp-loading" role="status">loading the full text…</div>
        ) : state === "external" ? (
          <div className="reader-empty">
            <p className="reader-empty-lead">No in-app text for this one.</p>
            <p>It didn't come with a readable body - open it where it lives.</p>
            <button className="btn" onClick={onOpen}>
              Open original
            </button>
          </div>
        ) : (
          <>
            {articleBody}
            <div className="rp-foot">
              {onSave && (
                <button className="reader-open" onClick={onSave}>
                  <Bookmark size={15} strokeWidth={1.75} aria-hidden />
                  Save
                </button>
              )}
              <button className="reader-open" onClick={onOpen}>
                <ExternalLink size={15} strokeWidth={1.75} aria-hidden />
                Open source
              </button>
            </div>
          </>
        )}
      </div>

      {/* #87: thin, always-visible, single-ink scroll-progress bar. */}
      <div className="rp-progress" aria-hidden>
        <div className="rp-progress-fill" style={{ transform: `scaleX(${progress})` }} />
      </div>

      {/* #149: full-screen zoomable photo viewer for a tapped article image. */}
      {viewerSrc && <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />}
    </div>
    </Overlay>
  );
}
