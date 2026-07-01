import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type BuildResponse, type Selected } from "@/api/client";

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

  const [resp, setResp] = useState<BuildResponse | null>(null);
  const [err, setErr] = useState("");
  const [acted, setActed] = useState<Record<number, string>>({});

  // Re-build whenever the query changes (including "more" appending ?n=).
  useEffect(() => {
    setResp(null);
    setErr("");
    api
      .buildSession(low, high, themes)
      .then(setResp)
      .catch((e) => setErr(String(e.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  function act(it: Selected, type: string) {
    setActed((a) => ({ ...a, [it.item.id]: type }));
    api.itemEvent(it.item.id, type, resp?.session_id).catch(() => {});
    if (type === "open") window.open(it.item.url, "_blank", "noopener");
  }

  if (err) return <div className="err">Couldn't build a session: {err}</div>;
  if (!resp) return <div className="spinner">composing…</div>;

  const items = resp.result.items;

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

  return (
    <div>
      <div className="section-label">
        {items.length} items · ~{fmtMin(resp.result.total_seconds)} · from {resp.result.pool_size} unseen
      </div>

      {items.map((it) => {
        const state = acted[it.item.id];
        return (
          <article className="card" key={it.item.id}>
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

      <div className="center" style={{ padding: "30px 0 10px" }}>
        <p className="display">That's your session.</p>
        <p style={{ color: "var(--ink-soft)" }}>Out of content for this ask.</p>
        <button
          className="btn"
          onClick={() => {
            // "more" = re-run the same ask; surfaced items are excluded server-side.
            const p = new URLSearchParams(params);
            p.set("n", String(Date.now()));
            nav(`/session?${p.toString()}`);
          }}
        >
          More like this
        </button>
        <button className="btn ghost" onClick={() => nav("/")}>
          Done
        </button>
      </div>
    </div>
  );
}
