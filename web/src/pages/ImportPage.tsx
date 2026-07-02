import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type CommitResult, type ImportCandidate } from "@/api/client";

const FORMAT_LABEL: Record<string, string> = {
  opml: "OPML (Feedly / podcasts / RSS reader)",
  "youtube-csv": "YouTube Takeout",
  "url-list": "URL list",
};

export default function ImportPage() {
  const nav = useNavigate();
  const [cands, setCands] = useState<ImportCandidate[]>([]);
  const [format, setFormat] = useState("");
  const [keep, setKeep] = useState<boolean[]>([]);
  const [makeFeeds, setMakeFeeds] = useState(true);
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);

  const hasCategories = useMemo(() => cands.some((c) => c.category), [cands]);
  const keptCount = keep.filter(Boolean).length;

  async function parse(body: string | Blob) {
    setErr("");
    setResult(null);
    if (typeof body === "string" && !body.trim()) return;
    try {
      const r = await api.parseImport(body);
      if (r.count === 0) {
        setErr("Nothing recognized in that file. Expected OPML, a YouTube Takeout CSV, or a list of feed URLs.");
        return;
      }
      setCands(r.candidates);
      setFormat(r.format);
      setKeep(r.candidates.map(() => true));
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    // Send the file as-is (a .zip must go as bytes, not text).
    parse(f);
  }

  async function commit() {
    setBusy(true);
    const chosen = cands.filter((_, i) => keep[i]);
    try {
      const r = await api.commitImport(chosen, makeFeeds && hasCategories);
      setResult(r);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="center">
        <p className="display">Imported.</p>
        <p style={{ color: "var(--ink-soft)" }}>
          {result.created} added
          {result.already_had > 0 && `, ${result.already_had} already followed`}
          {result.feeds_created > 0 && `, ${result.feeds_created} feeds created`}.
        </p>
        <p style={{ color: "var(--ink-faint)", fontSize: 13 }}>
          Feeds are refreshing in the background - items will fill in over the next minute or two.
        </p>
        <button className="btn" onClick={() => nav("/")}>
          Build a session
        </button>
        <button className="btn ghost" onClick={() => nav("/sources")}>
          Review library
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="display">Import your follows</h1>
      <p className="sub">
        Drop a <b>YouTube Takeout</b> (the raw <b>.zip</b> is fine — it's unpacked for you), an{" "}
        <b>OPML</b> file (Feedly, podcast apps, any RSS reader), or paste a list of feed URLs.
      </p>

      {cands.length === 0 ? (
        <>
          <label className="btn" style={{ display: "block", textAlign: "center" }}>
            Choose a file
            <input
              type="file"
              accept=".opml,.xml,.csv,.txt,.zip"
              onChange={onFile}
              style={{ display: "none" }}
            />
          </label>
          <div className="section-label">or paste URLs / OPML</div>
          <textarea
            className="field"
            style={{ minHeight: 120, fontFamily: "monospace", fontSize: 13 }}
            placeholder={"https://www.reddit.com/r/standupshots/.rss\nhttps://mastodon.social/@someone.rss"}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <button className="btn ghost" onClick={() => parse(paste)}>
            Parse pasted text
          </button>
          {err && <p className="err">{err}</p>}
        </>
      ) : (
        <>
          <div className="section-label">
            {FORMAT_LABEL[format] ?? format} · {keptCount} of {cands.length} selected
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button className="weight-pill" onClick={() => setKeep(cands.map(() => true))}>
              Select all
            </button>
            <button className="weight-pill" onClick={() => setKeep(cands.map(() => false))}>
              None
            </button>
          </div>
          {hasCategories && (
            <label className="row" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={makeFeeds} onChange={(e) => setMakeFeeds(e.target.checked)} />
              <div className="title">
                <b>Turn folders into feeds</b>
                <span>Uses your OPML folders as otium themes</span>
              </div>
            </label>
          )}

          <div style={{ maxHeight: "50vh", overflowY: "auto", margin: "8px 0" }}>
            {cands.map((c, i) => (
              <label className="row" key={i} style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={keep[i]}
                  onChange={(e) => setKeep((k) => k.map((v, j) => (j === i ? e.target.checked : v)))}
                />
                <div className="title">
                  <b>{c.title}</b>
                  <span>
                    {c.kind}
                    {c.category ? ` · ${c.category}` : ""}
                  </span>
                </div>
              </label>
            ))}
          </div>

          {err && <p className="err">{err}</p>}
          <button className="btn" onClick={commit} disabled={busy || keptCount === 0}>
            {busy ? "Importing…" : `Import ${keptCount} source${keptCount === 1 ? "" : "s"}`}
          </button>
          <button className="btn ghost" onClick={() => { setCands([]); setErr(""); }}>
            Start over
          </button>
        </>
      )}
    </div>
  );
}
