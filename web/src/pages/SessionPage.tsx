import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type Selected } from "@/api/client";

function fmtMin(sec: number) {
  const m = Math.round(sec / 60);
  return m < 1 ? "<1 min" : `${m} min`;
}

export default function SessionPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const low = Number(params.get("low") ?? 10);
  const high = Number(params.get("high") ?? 20);
  const themes = (params.get("themes") ?? "").split(",").filter(Boolean);

  const [items, setItems] = useState<Selected[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [err, setErr] = useState("");
  const [acted, setActed] = useState<Record<number, string>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const build = useCallback(
    async (append: boolean) => {
      try {
        const resp = await api.buildSession(low, high, themes);
        setSessionId(resp.session_id);
        const fresh = resp.result.items;
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
    build(false).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  async function loadMore() {
    setLoadingMore(true);
    const before = items.length;
    await build(true);
    setLoadingMore(false);
    // Nudge the newly-appended items into view.
    setTimeout(() => {
      if (items.length !== before) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function act(it: Selected, type: string) {
    setActed((a) => ({ ...a, [it.item.id]: type }));
    api.itemEvent(it.item.id, type, sessionId).catch(() => {});
    if (type === "open") window.open(it.item.url, "_blank", "noopener");
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

  const totalSec = items.reduce((n, it) => n + it.est_duration_sec, 0);

  return (
    <div>
      <div className="section-label">
        {items.length} items · ~{fmtMin(totalSec)}
        {themes.length > 0 && ` · ${themes.join(", ")}`}
      </div>

      {items.map((it, i) => {
        const state = acted[it.item.id];
        return (
          <article className="card" key={`${it.item.id}-${i}`}>
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
              <button className="act open" onClick={() => act(it, "open")}>
                Open ↗
              </button>
              <button
                className={`act ${state === "like" ? "on" : ""}`}
                onClick={() => act(it, "like")}
              >
                {state === "like" ? "Liked" : "Like"}
              </button>
              <button className="act" onClick={() => act(it, "skip")}>
                Skip
              </button>
            </div>
          </article>
        );
      })}

      <div ref={bottomRef} className="center" style={{ padding: "24px 0 10px" }}>
        {exhausted ? (
          <>
            <p className="display">That's everything new.</p>
            <p style={{ color: "var(--ink-soft)" }}>
              You're caught up on {themes.length ? themes.join(", ") : "everything you follow"}.
            </p>
            <button className="btn ghost" onClick={() => nav("/")}>
              Done
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Finding more…" : "More like this"}
            </button>
            <button className="btn ghost" onClick={() => nav("/")}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
