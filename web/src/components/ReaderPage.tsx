import { useEffect, useMemo, useRef, useState, type UIEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ExternalLink, Bookmark } from "lucide-react";
import { api, type Item, type ItemContent } from "@/api/client";
import { renderSummary } from "@/lib/html";
import { fmtDate, readTime } from "@/lib/format";
import { ShareActions } from "./ReaderActions";

// The in-app reader as a PUSHED PAGE (#85), not a sheet. Opening full-text
// content from the session slides in a full-screen page over everything; back
// pops it (SessionPage owns the history entry, exactly as the old sheet did in
// #78, so the Android back gesture still closes it). One scroll context - the
// sheet-over-page scroll fight is gone.
//
// It loads the reader body lazily via GET /items/{id}/content (#98/#99), so a
// teaser-only interest gets its readability-extracted full text on demand. When a
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
  item,
  sourceTitle,
  preloaded,
  open,
  onClose,
  onOpen,
  onSave,
}: {
  item: Item | null;
  sourceTitle?: string;
  preloaded?: ItemContent | null;
  open: boolean;
  onClose: () => void;
  onOpen: () => void; // open the original externally
  onSave?: () => void;
}) {
  // Keep mounted through the slide-out so the page animates away cleanly.
  const [mounted, setMounted] = useState(open);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setInView(true));
      return () => cancelAnimationFrame(id);
    }
    setInView(false);
    const t = window.setTimeout(() => setMounted(false), 320);
    return () => window.clearTimeout(t);
  }, [open]);

  const [state, setState] = useState<"loading" | "ready" | "external">("loading");
  const [body, setBody] = useState<Body>(null);
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
        .catch(() => decide(null));
    }
    return () => {
      cancelled = true;
    };
  }, [open, itemId, preloaded, item]);

  // Desktop keyboard controls (#4): backspace/escape closes back to the card,
  // space / arrows page the article. Active only while the reader is open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const el = scrollRef.current;
      switch (e.key) {
        case "Escape":
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

  // Swipe right anywhere on the page to go back to the feed (#120) - the primary
  // dismiss gesture on touch e-ink, alongside the back chevron / hardware back.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  function onPointerDown(e: ReactPointerEvent) {
    swipe.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e: ReactPointerEvent) {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (dx >= 80 && Math.abs(dx) >= Math.abs(dy) * 1.3) onClose();
  }

  const readEst = useMemo(() => (body ? readTime(body.html.replace(/<[^>]+>/g, " ")) : ""), [body]);

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

  if (!mounted || !item) return null;

  return (
    <div
      className={`readerpage ${inView ? "in" : ""}`}
      role="dialog"
      aria-modal="true"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div className="rp-topbar">
        <div className="readerpage-head">
        <button className="rp-back" onClick={onClose} aria-label="Back to card">
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
          {sourceTitle && <span>{sourceTitle}</span>}
          {sourceTitle && item.author && <span aria-hidden>·</span>}
          {item.author && <span>{item.author}</span>}
          {(sourceTitle || item.author) && item.published_at && <span aria-hidden>·</span>}
          {item.published_at && <span>{fmtDate(item.published_at)}</span>}
        </div>

        {state === "loading" ? (
          <div className="rp-loading">loading the full text…</div>
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
            <div className="reader-body" dangerouslySetInnerHTML={{ __html: body?.html ?? "" }} />
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
    </div>
  );
}
