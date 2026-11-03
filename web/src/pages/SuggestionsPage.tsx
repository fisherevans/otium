import { ArrowLeft, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useBack } from "@/lib/navigation";
import { api, type Suggestion } from "@/api/client";
import "./suggestions.css";

// Suggestions (#202): sources the recommender thinks fit what you already read,
// each with the reason it gave. "Trying" ones are already in your sessions as
// trial sources; keep them or drop them. "Suggested" ones are not in anything
// until you try them. Nothing here is ever followed without a tap.
const KIND: Record<string, string> = { bluesky: "Bluesky", substack: "Substack", medium: "Medium", youtube: "YouTube", rss: "Feed" };

export default function SuggestionsPage() {
  const back = useBack("/sections");
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  function load() {
    api.suggestions().then(setList).catch((e) => setErr(String(e.message ?? e)));
  }
  useEffect(load, []);

  async function act(s: Suggestion, action: "try" | "keep" | "dismiss") {
    setBusy(s.id);
    setErr("");
    try {
      await api.suggestionAction(s.id, action);
      load();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  const trying = list?.filter((s) => s.status === "trial") ?? [];
  const pending = list?.filter((s) => s.status === "pending") ?? [];

  function row(s: Suggestion) {
    return (
      <div key={s.id} className="sugg-row">
        <div className="sugg-head">
          {s.icon_url ? <img className="sugg-av" src={s.icon_url} alt="" /> : <span className="sugg-av ph" aria-hidden />}
          <div className="sugg-id">
            <div className="sugg-name">{s.title}</div>
            <div className="sugg-meta">
              {KIND[s.kind] ?? s.kind}
              {s.status === "trial" && <> · {s.shown ? `${s.opened} of ${s.shown} opened so far` : "not shown yet"}</>}
            </div>
          </div>
          {s.home_url && (
            <a className="sugg-open" href={s.home_url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${s.title}`}>
              <ExternalLink size={16} aria-hidden />
            </a>
          )}
        </div>
        {s.reason && <p className="sugg-reason">{s.reason}</p>}
        <div className="sugg-actions">
          {s.status === "trial" ? (
            <>
              <button className="btn" disabled={busy === s.id} onClick={() => act(s, "keep")}>Keep following</button>
              <button className="btn ghost" disabled={busy === s.id} onClick={() => act(s, "dismiss")}>Drop it</button>
            </>
          ) : (
            <>
              <button className="btn" disabled={busy === s.id} onClick={() => act(s, "try")}>Try it</button>
              <button className="btn ghost" disabled={busy === s.id} onClick={() => act(s, "dismiss")}>Not for me</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sugg-page">
      <button className="lib-back" onClick={back}>
        <ArrowLeft size={18} className="inline-icon" aria-hidden /> Library
      </button>
      <div className="lib-topbar">
        <h1 className="display">Suggestions</h1>
      </div>
      <p className="sugg-intro">Sources that fit what you already read, each with the reason. Trying one adds it to your sessions as a trial.</p>
      {err && <p className="err" role="alert">{err}</p>}
      {!list && !err && <p role="status">Loading…</p>}
      {list && trying.length === 0 && pending.length === 0 && <p className="sub">No suggestions right now.</p>}
      {trying.length > 0 && (
        <>
          <h2 className="sugg-h">Trying now</h2>
          {trying.map(row)}
        </>
      )}
      {pending.length > 0 && (
        <>
          <h2 className="sugg-h">Suggested</h2>
          {pending.map(row)}
        </>
      )}
    </div>
  );
}
