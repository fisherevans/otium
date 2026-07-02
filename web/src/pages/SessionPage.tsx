import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type Selected } from "@/api/client";

function fmtMin(sec: number) {
  const m = Math.round(sec / 60);
  return m < 1 ? "<1 min" : `${m} min`;
}

type Checkin = null | "low" | "high" | "fast";

export default function SessionPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const low = Number(params.get("low") ?? 10);
  const high = Number(params.get("high") ?? 20);
  const themes = (params.get("themes") ?? "").split(",").filter(Boolean);
  const lowSec = low * 60;
  const highSec = high * 60;

  const [items, setItems] = useState<Selected[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [err, setErr] = useState("");
  const [acted, setActed] = useState<Record<number, string>>({});

  // elapsed = active foreground seconds (pauses when the tab/phone is hidden).
  const [elapsed, setElapsed] = useState(0);
  const [checkin, setCheckin] = useState<Checkin>(null);
  const ackLow = useRef(false);
  const ackHigh = useRef(false);
  const skipTimes = useRef<number[]>([]);
  const shownIds = useRef<Set<number>>(new Set());
  const observer = useRef<IntersectionObserver | null>(null);

  const build = useCallback(
    async (append: boolean) => {
      try {
        const resp = await api.buildSession(low, high, themes);
        setSessionId(resp.session_id);
        const fresh = resp.result.items.filter((s) => !shownIds.current.has(s.item.id));
        if (append) {
          if (fresh.length === 0) setExhausted(true);
          else setItems((prev) => [...prev, ...fresh]);
        } else {
          setItems(fresh);
          setExhausted(fresh.length === 0);
        }
      } catch (e: any) {
        setErr(String(e.message ?? e));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.toString()],
  );

  // Fresh session whenever the intent (query) changes.
  useEffect(() => {
    setItems([]);
    setExhausted(false);
    setErr("");
    setLoading(true);
    setElapsed(0);
    ackLow.current = false;
    ackHigh.current = false;
    skipTimes.current = [];
    shownIds.current = new Set();
    build(false).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  // Active-time ticker: only counts while the page is visible.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setElapsed((e) => e + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Pacing check-ins driven by elapsed time. High supersedes low.
  useEffect(() => {
    if (checkin) return;
    if (elapsed >= highSec && !ackHigh.current) {
      ackHigh.current = true;
      setCheckin("high");
    } else if (elapsed >= lowSec && !ackLow.current && low !== high) {
      ackLow.current = true;
      setCheckin("low");
    }
  }, [elapsed, lowSec, highSec, low, high, checkin]);

  const autoMore = elapsed < highSec; // keep feeding only while inside the budget

  // Mark an item seen (once) as it scrolls into view, and auto-refill when the
  // last staged item appears and there's still time on the clock.
  const attachObserver = useCallback(
    (el: HTMLElement | null, itemId: number, isLast: boolean) => {
      if (!el) return;
      if (!observer.current) {
        observer.current = new IntersectionObserver(
          (entries) => {
            for (const en of entries) {
              if (!en.isIntersecting) continue;
              const id = Number((en.target as HTMLElement).dataset.id);
              if (id && !shownIds.current.has(id)) {
                shownIds.current.add(id);
                api.itemEvent(id, "seen", sessionId).catch(() => {});
              }
              if ((en.target as HTMLElement).dataset.last === "true") {
                if (autoMore) void loadMore();
              }
            }
          },
          { threshold: 0.6 },
        );
      }
      el.dataset.id = String(itemId);
      el.dataset.last = String(isLast);
      observer.current.observe(el);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, autoMore],
  );

  useEffect(() => () => observer.current?.disconnect(), []);

  async function loadMore() {
    if (loadingMore || exhausted) return;
    setLoadingMore(true);
    await build(true);
    setLoadingMore(false);
  }

  function act(it: Selected, type: string) {
    setActed((a) => ({ ...a, [it.item.id]: type }));
    api.itemEvent(it.item.id, type, sessionId).catch(() => {});
    if (type === "open") window.open(it.item.url, "_blank", "noopener");
    if (type === "skip") {
      const now = Date.now();
      skipTimes.current = [...skipTimes.current, now].slice(-4);
      const recent = skipTimes.current.filter((t) => now - t < 8000);
      if (recent.length >= 3 && !checkin) setCheckin("fast");
    }
  }

  function dismissCheckin() {
    setCheckin(null);
    skipTimes.current = [];
  }

  if (err) return <div className="err">Couldn't build a session: {err}</div>;
  if (loading) return <div className="spinner">composing…</div>;

  if (items.length === 0) {
    return (
      <div className="center">
        <p className="display">Nothing new to surface.</p>
        <p>You're caught up on {themes.length ? themes.join(", ") : "everything you follow"}.</p>
        <button className="btn ghost" onClick={() => nav("/")}>
          Back to intent
        </button>
      </div>
    );
  }

  const budgetLabel = low === high ? `${low} min` : `${low}–${high} min`;
  const progress = Math.min(1, elapsed / highSec);

  return (
    <div>
      {/* time budget, not item count: how much of your clock you've spent */}
      <div className="timebar">
        <div className="timebar-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="section-label" style={{ marginTop: 8 }}>
        {fmtMin(elapsed)} of {budgetLabel}
        {themes.length > 0 && ` · ${themes.join(", ")}`}
      </div>

      {checkin && (
        <div className="checkin">
          {checkin === "low" && (
            <>
              <p>You've spent about {low} min. Keep going, or wrap up?</p>
              <div className="checkin-actions">
                <button className="act" onClick={dismissCheckin}>Keep going</button>
                <button className="act open" onClick={() => nav("/")}>Wrap up</button>
              </div>
            </>
          )}
          {checkin === "high" && (
            <>
              <p>That's about {high} min — your session's worth. Done, or a few more?</p>
              <div className="checkin-actions">
                <button className="act" onClick={dismissCheckin}>A few more</button>
                <button className="act open" onClick={() => nav("/")}>Done</button>
              </div>
            </>
          )}
          {checkin === "fast" && (
            <>
              <p>Flicking past these? Want a different mix, or keep going?</p>
              <div className="checkin-actions">
                <button className="act" onClick={dismissCheckin}>Keep going</button>
                <button className="act open" onClick={() => nav("/")}>Change mix</button>
              </div>
            </>
          )}
        </div>
      )}

      {items.map((it, i) => {
        const state = acted[it.item.id];
        const isLast = i === items.length - 1;
        return (
          <article
            className="card"
            key={`${it.item.id}-${i}`}
            ref={(el) => attachObserver(el, it.item.id, isLast)}
          >
            <span className="reason">{it.reason}</span>
            <h3>{it.item.title}</h3>
            <div className="meta">
              <span>{it.source_title}</span>
              <span>·</span>
              <span>{fmtMin(it.est_duration_sec)}</span>
              {it.item.media_type !== "unknown" && (
                <>
                  <span>·</span>
                  <span>{it.item.media_type}</span>
                </>
              )}
            </div>
            {it.item.summary && <p className="summary">{it.item.summary}</p>}
            <div className="actions">
              <button className="act open" onClick={() => act(it, "open")}>Open ↗</button>
              <button className={`act ${state === "like" ? "on" : ""}`} onClick={() => act(it, "like")}>
                {state === "like" ? "Liked" : "Like"}
              </button>
              <button className="act" onClick={() => act(it, "skip")}>Skip</button>
            </div>
          </article>
        );
      })}

      <div className="center" style={{ padding: "20px 0 10px" }}>
        {loadingMore ? (
          <p style={{ color: "var(--ink-faint)" }}>Finding more…</p>
        ) : exhausted ? (
          <>
            <p className="display">That's everything new.</p>
            <p style={{ color: "var(--ink-soft)" }}>
              You're caught up on {themes.length ? themes.join(", ") : "everything you follow"}.
            </p>
            <button className="btn ghost" onClick={() => nav("/")}>Done</button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={loadMore}>More</button>
            <button className="btn ghost" onClick={() => nav("/")}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
