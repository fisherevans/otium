import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent, type SyntheticEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ExternalLink, Bookmark } from "lucide-react";
import { api, type Item, type ItemContent } from "@/api/client";
import { renderSummary } from "@/lib/html";
import { fmtDate, readTime, authorRedundant } from "@/lib/format";
import { ShareActions } from "./ReaderActions";
import { ImageViewer } from "./ImageViewer";
import { ContextInstrument } from "./ContextInstrument";
import { BottomSheet } from "./BottomSheet";
import "./session-afterglow.css";
import { Overlay, instantMotion, usePresence } from "./Overlay";
import { ReaderConversation } from "./Conversation";
import { PlatformMark } from "./PlatformMark";
import { headline, isPost, postBody, postCounts } from "@/lib/posts";
import { PostCard, ReaderThread } from "./PostView";
import { useConversationState } from "@/lib/conversation";

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
  onNextDrag,
}: {
  item: Item | null;
  sourceTitle?: string;
  preloaded?: ItemContent | null;
  open: boolean;
  onClose: () => void;
  onOpen: () => void; // open the original externally
  onSave?: () => void;
  onNext?: () => void; // #149: swipe up at the bottom -> advance the feed, close the reader
  // #206: the end-of-article pull, in px of upward travel, so the feed behind can
  // move with it (the next card follows the page up); null when it springs back.
  onNextDrag?: (offset: number | null) => void;
}) {
  const previousItem = useRef(currentItem);
  if (currentItem) previousItem.current = currentItem;
  const item = currentItem ?? previousItem.current;
  const { mounted, visible: inView } = usePresence(open);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const pageRef = useRef<HTMLDivElement>(null);
  const readerActions = useRef({ onNext, onClose, onNextDrag });
  readerActions.current = { onNext, onClose, onNextDrag };
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
  const mode = useRef<"undecided" | "swipe" | "scroll" | "pull">("undecided");
  const SLOP = 8; // px of travel before we commit to an axis
  // #149/#206: at the very bottom there is nothing left to scroll, so pushing the
  // page up is "next". The page follows the finger from the first pixel (no dead
  // zone) and the next card follows it up from below (onNextDrag moves the feed
  // behind by the same amount). Released past a quarter of the screen, or flicked,
  // it settles onto the next item; otherwise it springs back. Only armed when the
  // gesture STARTS at the bottom, so a normal upward scroll mid-article never pulls.
  function atBottom() {
    const el = scrollRef.current;
    if (!el) return false;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
  }
  const pull = usePull(pageRef, () => readerActions.current.onNextDrag, () => {
    setAdvanced(true);
    readerActions.current.onNext?.();
  });
  function cancelGesture() {
    start.current = null;
    mode.current = "undecided";
    setDrag(null);
    setDragging(false);
  }
  function onPointerDown(e: ReactPointerEvent) {
    if (e.pointerType === "touch") return;
    pointers.current.add(e.pointerId);
    if (pointers.current.size !== 1 || !e.isPrimary || (window.visualViewport?.scale ?? 1) > 1.05) {
      if (mode.current === "pull") pull.release(true);
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
      if (s.atBottom && onNext && dy < 0 && -dy >= Math.abs(dx)) {
        // Upward at the bottom: the page moves with the pointer from here on.
        mode.current = "pull";
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* best-effort */ }
      } else {
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
    }
    if (mode.current === "pull") pull.move(-dy);
    else if (mode.current === "swipe") setDrag(Math.max(0, dx));
  }
  function onPointerUp(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const was = mode.current;
    const dx = e.clientX - s.x;
    cancelGesture();
    if (was === "pull") pull.release(false);
    else if (was === "swipe" && dx > 90) onClose();
  }
  function onPointerCancel(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
    if (mode.current === "pull") pull.release(true);
    cancelGesture();
  }

  // Native touch listeners own the bottom pull and the back swipe. The pull
  // cancels the first upward touchmove at the bottom, which keeps WebKit's
  // rubber band (and Chromium's overscroll) out of it: the only thing that moves
  // is the page, under the finger.
  useEffect(() => {
    const page = pageRef.current;
    if (!open || !mounted || !page) return;
    let touch: { id: number; x: number; y: number; bottom: boolean; axis: string | null } | null = null;
    const blocked = () => (window.visualViewport?.scale ?? 1) > 1.02 || !!window.getSelection()?.toString();
    const cancel = () => {
      if (touch?.axis === "pull") pull.release(true);
      touch = null; setDrag(null); setDragging(false);
    };
    const down = (event: TouchEvent) => {
      cancel();
      if (event.touches.length !== 1 || blocked() || (event.target as Element).closest("button,a,input,textarea,select,iframe,video,audio,img,[contenteditable]")) return;
      const point = event.touches[0];
      touch = { id: point.identifier, x: point.clientX, y: point.clientY, bottom: atBottom(), axis: null };
    };
    const move = (event: TouchEvent) => {
      if (!touch) return;
      if (event.touches.length !== 1 || blocked()) { cancel(); return; }
      const point = event.touches[0];
      if (point.identifier !== touch.id) { cancel(); return; }
      const dx = point.clientX - touch.x, dy = point.clientY - touch.y;
      if (!touch.axis && touch.bottom && readerActions.current.onNext && dy < 0 && -dy >= Math.abs(dx)) touch.axis = "pull";
      else if (!touch.axis && Math.hypot(dx, dy) > 12) touch.axis = Math.abs(dx) > Math.abs(dy) * 1.2 && dx > 0 ? "right" : "scroll";
      if (touch.axis === "pull") {
        if (event.cancelable) event.preventDefault();
        pull.move(-dy);
        return;
      }
      const back = touch.axis === "right" && touch.x > 24 && dx > 14 && dx > Math.abs(dy) * 1.5;
      if (back && event.cancelable) event.preventDefault();
      if (back) { setDragging(true); setDrag(Math.max(0, dx)); }
    };
    const up = (event: TouchEvent) => {
      const gesture = touch;
      touch = null;
      setDrag(null);
      setDragging(false);
      if (!gesture) return;
      if (gesture.axis === "pull") { pull.release(event.touches.length > 0 || blocked()); return; }
      if (event.touches.length || blocked()) return;
      const point = Array.from(event.changedTouches).find((point) => point.identifier === gesture.id);
      if (!point) return;
      const dx = point.clientX - gesture.x, dy = point.clientY - gesture.y;
      if (gesture.axis === "right" && gesture.x > 24 && dx >= 90 && dx > Math.abs(dy) * 1.5) readerActions.current.onClose();
    };
    page.addEventListener("touchstart", down, { passive: true });
    page.addEventListener("touchmove", move, { passive: false });
    page.addEventListener("touchend", up, { passive: true });
    page.addEventListener("touchcancel", cancel, { passive: true });
    document.addEventListener("visibilitychange", cancel);
    return () => {
      page.removeEventListener("touchstart", down); page.removeEventListener("touchmove", move);
      page.removeEventListener("touchend", up); page.removeEventListener("touchcancel", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted, itemId]);

  const post = !!item && isPost(item);
  // #207: a post opens as the post - its card with the engagement row under it -
  // then every reply threaded, then quotes, then Bluesky. No article body.
  const postConv = useConversationState(post ? item : null, open && post);
  const readEst = useMemo(() => (body ? readTime(body.html.replace(/<[^>]+>/g, " ")) : ""), [body]);

  // #149: tapping an image in the article opens the full-screen zoomable viewer.
  // The body is dangerouslySetInnerHTML, so we catch the click on the container and
  // check the target. Stable (useCallback) so the memoized article element below
  // keeps its reference and the flicker fix holds.
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  useEffect(() => { if (!open) setViewerSrc(null); }, [open]);
  const onBodyClick = useCallback((e: ReactMouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "IMG" && !t.closest("a, .bp-head, .bp-reply, .bp-quote")) {
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
    <Overlay active={open} label={headline(item, 90)} onClose={onClose}>
    <div
      ref={pageRef}
      className={`readerpage afterglow-reader ${inView ? "in" : ""} ${dragging ? "dragging" : ""}`}
      style={drag != null ? { transform: `translateX(${drag}px)` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="rp-topbar">
        <div className="readerpage-head">
        <span className="rp-section-label">{post ? "Post" : "Article"}</span>
        {readEst && !post && <span className="rp-readtime">{readEst}</span>}
        <div className="rp-actions">
          {onSave && (
            <button className="rp-act" onClick={onSave} aria-label="Save">
              <Bookmark size={18} strokeWidth={1.75} aria-hidden />
            </button>
          )}
          <button className="rp-act" onClick={onOpen} aria-label="Open original">
            <ExternalLink size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <ShareActions item={item} discord />
        </div>
        </div>
        <div className={`rp-revealbar ${revealed ? "in" : ""}`} aria-hidden={!revealed}>
          <span className="rp-reveal-title">{headline(item, 90)}</span>
          {item.published_at && <span className="rp-reveal-date">{fmtDate(item.published_at)}</span>}
        </div>
      </div>

      <div className={`readerpage-body ${post ? "rp-post" : ""}`} ref={scrollRef} onScroll={onScroll}>
        {post ? (
          <div className="rp-postview" onClick={onBodyClick}>
            <PostCard body={postBody(item, sourceTitle ?? item.author)} publishedAt={item.published_at || item.fetched_at}
              url={item.url} counts={postCounts(item, postConv.conv)} full />
            <ReaderThread conv={postConv.conv} url={item.url} status={postConv.status} />
            <div className="rp-foot">
              {onSave && (
                <button className="reader-open" onClick={onSave}>
                  <Bookmark size={15} strokeWidth={1.75} aria-hidden />
                  Save
                </button>
              )}
            </div>
            {onNext && <p className="reader-next-cue">Swipe up for the next item</p>}
          </div>
        ) : (<>
        <h1 className="rp-title">{item.title}</h1>
        <div className="rp-meta">
          {(() => {
            // #2: omit the author when it just repeats the source.
            const showAuthor = !!item.author && !authorRedundant(item.author, sourceTitle);
            return (
              <>
                {sourceTitle && <span className="rp-source">{sourceTitle}<PlatformMark kind={item.source_kind} size={12} /></span>}
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
            <p className="reader-empty-lead">No article text available.</p>
            <p>Open the original to read this article.</p>
            <button className="btn" onClick={onOpen}>
              Open original
            </button>
          </div>
        ) : (
          <>
            {articleBody}
            {/* #200: replies most-liked first, then quotes, then the platform. */}
            <ReaderConversation item={item} />
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
            {onNext && <p className="reader-next-cue">Swipe up for the next item</p>}
          </>
        )}
        </>)}
      </div>

      <ContextInstrument mode="reader" eyebrow="Reading" label={progress >= .96 ? (post ? "End of post" : "End of article") : progress > .7 ? "Near the end" : sourceTitle || (post ? "Post" : "Article")}
        onMenu={() => setMenuOpen(true)} menuLabel="Article actions"
        action={{ label: "Back", onClick: onClose, icon: <ChevronLeft size={18} aria-hidden /> }} />
      <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} kicker="Article actions">
        <div className="sheet-rows">
          {onSave && <button className="sheet-row" onClick={() => { setMenuOpen(false); onSave(); }}><span>Save to collection</span><Bookmark size={18} aria-hidden /></button>}
          <button className="sheet-row" onClick={onOpen}><span>Open original</span><ExternalLink size={18} aria-hidden /></button>
          <ShareActions item={item} labeled discord />
        </div>
      </BottomSheet>

      {/* #149: full-screen zoomable photo viewer for a tapped article image. */}
      {viewerSrc && <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />}
    </div>
    </Overlay>
  );
}

// #206: the end-of-article pull. Moves the page with the finger (direct DOM
// writes, no React render per frame), reports the same offset to the feed behind,
// and on release settles to a full screen (commit) or back to zero. The settle is
// one rAF loop driving both, so the page and the next card cannot drift apart;
// reduced motion and e-ink settle at once.
function usePull(pageRef: React.RefObject<HTMLDivElement | null>, follower: () => ((offset: number | null) => void) | undefined, commit: () => void) {
  const state = useRef({ offset: 0, active: false, frame: 0, samples: [] as { t: number; d: number }[] });
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => () => cancelAnimationFrame(state.current.frame), []);
  function paint(offset: number) {
    const page = pageRef.current;
    state.current.offset = offset;
    if (page) {
      page.style.transition = "none";
      page.style.transform = offset > 0 ? `translate3d(0, ${-offset}px, 0)` : "";
      // The page reads as a sheet lifting off the next card, not more article.
      page.style.boxShadow = offset > 0 ? "0 12px 28px rgb(0 0 0 / .16)" : "";
    }
    follower()?.(offset);
  }
  function move(raw: number) {
    const s = state.current;
    if (!s.active) { cancelAnimationFrame(s.frame); s.active = true; s.samples = []; }
    const height = window.innerHeight;
    const offset = Math.max(0, Math.min(raw, height));
    const now = performance.now();
    s.samples.push({ t: now, d: offset });
    while (s.samples.length > 2 && now - s.samples[0].t > 100) s.samples.shift();
    paint(offset);
  }
  function release(cancelled: boolean) {
    const s = state.current;
    if (!s.active) return;
    s.active = false;
    const height = window.innerHeight;
    // Upward speed over the last ~100ms of movement, in px/ms. A finger that
    // stopped before lifting is not a flick, and a burst of events with no real
    // time between them is no evidence of one.
    const first = s.samples[0], last = s.samples[s.samples.length - 1];
    const span = first && last ? last.t - first.t : 0;
    const velocity = span >= 16 && performance.now() - last.t < 80 ? (last.d - first.d) / span : 0;
    const go = !cancelled && (s.offset >= height * 0.25 || (s.offset > 48 && velocity > 0.3));
    const from = s.offset, to = go ? height : 0;
    const done = () => {
      if (go) { latest.current(); return; }
      const page = pageRef.current;
      if (page) { page.style.transform = ""; page.style.transition = ""; page.style.boxShadow = ""; }
      follower()?.(null);
    };
    if (instantMotion() || from === to) { if (go) paint(to); done(); return; }
    // Duration scales with the distance left, so a near-complete pull is quick.
    const ms = Math.max(140, Math.min(320, Math.abs(to - from) * 0.55));
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      paint(from + (to - from) * eased);
      if (p < 1) s.frame = requestAnimationFrame(step);
      else done();
    };
    s.frame = requestAnimationFrame(step);
  }
  return { move, release };
}
