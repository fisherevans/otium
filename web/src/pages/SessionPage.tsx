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
  const [i, setI] = useState(0); // index of the one item on screen
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [err, setErr] = useState("");
  const [acted, setActed] = useState<Record<number, string>>({});

  const [elapsed, setElapsed] = useState(0);
  const [checkin, setCheckin] = useState<Checkin>(null);
  const ackLow = useRef(false);
  const ackHigh = useRef(false);
  const skipTimes = useRef<number[]>([]);
  const shownIds = useRef<Set<number>>(new Set());

  const build = useCallback(
    async (append: boolean): Promise<number> => {
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
        return fresh.length;
      } catch (e: any) {
        setErr(String(e.message ?? e));
        return 0;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.toString()],
  );

  // Fresh session on intent change.
  useEffect(() => {
    setItems([]);
    setI(0);
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

  // Active-time ticker (pauses while hidden).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setElapsed((e) => e + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // The item currently on screen is, by definition, seen.
  const current = items[i];
  useEffect(() => {
    if (!current) return;
    if (!shownIds.current.has(current.item.id)) {
      shownIds.current.add(current.item.id);
      api.itemEvent(current.item.id, "seen", sessionId).catch(() => {});
    }
  }, [current, sessionId]);

  // Pacing check-ins.
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

  async function loadMore(): Promise<number> {
    if (loadingMore || exhausted) return 0;
    setLoadingMore(true);
    const n = await build(true);
    setLoadingMore(false);
    return n;
  }

  // Advance to the next item. A `skip` carries a negative signal; a plain next is
  // neutral. Refills when we run off the end and there's still time.
  async function advance(signal?: "skip" | "like") {
    const cur = items[i];
    if (cur && signal) {
      setActed((a) => ({ ...a, [cur.item.id]: signal }));
      api.itemEvent(cur.item.id, signal, sessionId).catch(() => {});
      if (signal === "skip") {
        const now = Date.now();
        skipTimes.current = [...skipTimes.current, now].slice(-4);
        if (skipTimes.current.filter((t) => now - t < 8000).length >= 3 && !checkin) {
          setCheckin("fast");
          return; // hold on the current item until they answer
        }
      }
    }
    const next = i + 1;
    if (next < items.length) {
      setI(next);
      return;
    }
    // Off the end: refill if we're still inside the budget.
    if (!exhausted && elapsed < highSec) {
      const got = await loadMore();
      if (got > 0) setI(next);
      else setI(next); // exhausted now -> end screen
    } else {
      setI(next);
    }
  }

  function openItem() {
    const cur = items[i];
    if (!cur) return;
    setActed((a) => ({ ...a, [cur.item.id]: "open" }));
    api.itemEvent(cur.item.id, "open", sessionId).catch(() => {});
    window.open(cur.item.url, "_blank", "noopener");
  }

  function dismissCheckin() {
    setCheckin(null);
    skipTimes.current = [];
  }

  if (err) return <div className="err">Couldn't build a session: {err}</div>;
  if (loading) return <div className="spinner">composing…</div>;

  const budgetLabel = low === high ? `${low} min` : `${low}–${high} min`;
  const progress = Math.min(1, elapsed / highSec);

  const timeHeader = (
    <>
      <div className="timebar">
        <div className="timebar-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="section-label" style={{ marginTop: 8 }}>
        {fmtMin(elapsed)} of {budgetLabel}
        {themes.length > 0 && ` · ${themes.join(", ")}`}
      </div>
    </>
  );

  const checkinBanner = checkin && (
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
  );

  // Ran off the end of the queue.
  if (!current) {
    if (loadingMore) {
      return (
        <div>
          {timeHeader}
          <div className="spinner">finding more…</div>
        </div>
      );
    }
    return (
      <div>
        {timeHeader}
        <div className="center">
          <p className="display">{exhausted ? "That's everything new." : "That's your session."}</p>
          <p style={{ color: "var(--ink-soft)" }}>
            {exhausted
              ? `You're caught up on ${themes.length ? themes.join(", ") : "everything you follow"}.`
              : `You've spent about ${fmtMin(elapsed)}.`}
          </p>
          {!exhausted && (
            <button className="btn ghost" onClick={() => advance()}>A few more</button>
          )}
          <button className="btn" onClick={() => nav("/")}>Done</button>
        </div>
      </div>
    );
  }

  const state = acted[current.item.id];
  return (
    <div>
      {timeHeader}
      {checkinBanner}

      <article className="card focus">
        <span className="reason">{current.reason}</span>
        <h3>{current.item.title}</h3>
        <div className="meta">
          <span>{current.source_title}</span>
          <span>·</span>
          <span>{fmtMin(current.est_duration_sec)}</span>
          {current.item.media_type !== "unknown" && (
            <>
              <span>·</span>
              <span>{current.item.media_type}</span>
            </>
          )}
        </div>
        {current.item.summary && <p className="summary">{current.item.summary}</p>}

        <div className="focus-open">
          <button className="btn" onClick={openItem}>Open ↗</button>
        </div>
        <div className="actions">
          <button className="act" onClick={() => advance("skip")}>Skip</button>
          <button
            className={`act ${state === "like" ? "on" : ""}`}
            onClick={() => advance("like")}
          >
            Like
          </button>
          <button className="act open" onClick={() => advance()}>Next →</button>
        </div>
      </article>

      <p className="center" style={{ color: "var(--ink-faint)", fontSize: 12, padding: "6px 0 0" }}>
        one at a time · {state ? state : "unread"}
      </p>
    </div>
  );
}
