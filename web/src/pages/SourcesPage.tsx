import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Source } from "@/api/client";

const BUCKETS = ["very_low", "low", "normal", "high", "favorite"] as const;
const BUCKET_LABEL: Record<string, string> = {
  very_low: "very low",
  low: "low",
  normal: "normal",
  high: "high",
  favorite: "favorite",
};
function bucketOf(weight: number): string {
  if (weight <= 0.25) return "very_low";
  if (weight <= 0.5) return "low";
  if (weight <= 1) return "normal";
  if (weight <= 2) return "high";
  return "favorite";
}

export default function SourcesPage() {
  const nav = useNavigate();
  const [sources, setSources] = useState<Source[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState("rss");
  const [err, setErr] = useState("");
  const [fetching, setFetching] = useState(false);

  function reload() {
    api.sources().then(setSources).catch((e) => setErr(String(e.message ?? e)));
  }
  useEffect(reload, []);

  async function add() {
    if (!url.trim()) return;
    setErr("");
    try {
      await api.createSource({ title: title.trim() || url, feed_url: url.trim(), kind });
      setTitle("");
      setUrl("");
      setAdding(false);
      reload();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }

  async function cycleWeight(s: Source) {
    const cur = BUCKETS.indexOf(bucketOf(s.weight) as any);
    const next = BUCKETS[(cur + 1) % BUCKETS.length];
    await api.updateSource(s.id, { weight_bucket: next }).catch(() => {});
    reload();
  }

  async function remove(s: Source) {
    await api.deleteSource(s.id).catch(() => {});
    reload();
  }

  async function fetchNow() {
    setFetching(true);
    await api.fetchNow().catch(() => {});
    setFetching(false);
    reload();
  }

  return (
    <div>
      <h1 className="display">Your library</h1>
      <p className="sub">The creators and feeds you've chosen. Weight controls how often they surface.</p>

      <button className="btn" style={{ marginTop: 0 }} onClick={() => nav("/import")}>
        Import your follows (YouTube, Feedly, OPML…)
      </button>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn ghost" style={{ marginTop: 0 }} onClick={() => setAdding((a) => !a)}>
          {adding ? "Cancel" : "+ Add one"}
        </button>
        <button className="btn ghost" style={{ marginTop: 0 }} onClick={fetchNow} disabled={fetching}>
          {fetching ? "Refreshing…" : "Refresh feeds"}
        </button>
      </div>

      {adding && (
        <div style={{ marginTop: 16 }}>
          <input className="field" placeholder="Feed URL (RSS / Atom / YouTube feed)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="field" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="rss">RSS / blog / news</option>
            <option value="youtube">YouTube channel</option>
            <option value="podcast">Podcast</option>
          </select>
          <button className="btn" onClick={add}>
            Add
          </button>
        </div>
      )}

      {err && <p className="err">{err}</p>}

      <div className="section-label">{sources.length} sources</div>
      {sources.map((s) => (
        <div className="row" key={s.id}>
          <div className="title">
            <b>{s.title}</b>
            <span>
              {s.kind} · {s.unseen_count ?? 0} unseen{s.fetch_error ? " · fetch error" : ""}
            </span>
          </div>
          <button className="weight-pill" onClick={() => cycleWeight(s)}>
            {BUCKET_LABEL[bucketOf(s.weight)]}
          </button>
          <button className="weight-pill" onClick={() => remove(s)} aria-label="remove">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
