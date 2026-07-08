import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil, Settings, Copy, Check, Mail, Ban, EyeOff } from "lucide-react";
import { api, type Interest, type Source, type SourceItem, type SourceStats } from "@/api/client";
import { bucketOf, BUCKETS, REP_FREQ, REP_HINT, REP_LEVEL, REP_PROSE, REP_LABEL, compareToAverage, type Bucket } from "@/lib/represent";
import { resolveSourceArchive, itemEligible } from "@/lib/archive";
import { sourceInsight, type InsightKind } from "@/lib/stats";
import { scaleCadence, cadenceCount } from "@/lib/cadence";
import { relDate } from "@/lib/format";
import { Dialog } from "@/components/Dialog";
import { ArchiveChoice } from "@/components/ArchiveChoice";

// The Source page (session engine v2, mockup #4). A dense single scroll of
// read-only, plain-English transparency: publishing rate + engagement stats up
// top, then the feed controls (archival, representation, keywords) shown as prose
// and edited in a centered dialog, an article preview with per-item status, and
// the destructive/utility actions. Nothing is edited inline - editing is always a
// deliberate dialog.

function parseKeywords(s?: string): string[] {
  return (s ?? "").split(",").map((k) => k.trim()).filter(Boolean);
}
function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
function Dots({ level }: { level: number }) {
  return (
    <span className="rep-dots" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`rep-dot ${i <= level ? "on" : ""}`} />
      ))}
    </span>
  );
}


export default function SourcePage() {
  const nav = useNavigate();
  const { id } = useParams();
  const sourceId = Number(id);

  const [sources, setSources] = useState<Source[] | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [stats, setStats] = useState<Record<number, SourceStats>>({});
  const [posts, setPosts] = useState<SourceItem[] | null>(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // dialogs
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [kwDraft, setKwDraft] = useState("");
  const [interestOpen, setInterestOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [delOpen, setDelOpen] = useState(false);

  const source = useMemo(() => (sources ? sources.find((s) => s.id === sourceId) ?? null : null), [sources, sourceId]);
  const st = stats[sourceId];
  const interest = useMemo(
    () => interests.find((i) => i.slug === (source?.interest_slug ?? "")) ?? null,
    [interests, source?.interest_slug],
  );

  function reload() {
    api.sources().then(setSources).catch((e) => setErr(String(e.message ?? e)));
  }
  function reloadStats() {
    api.sourceStats().then(setStats).catch(() => {});
  }
  useEffect(() => {
    reload();
    reloadStats();
    api.interests().then(setInterests).catch(() => {});
  }, []);
  useEffect(() => {
    if (sourceId) api.sourceItems(sourceId).then(setPosts).catch(() => {});
  }, [sourceId]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }

  const bucket: Bucket = source ? bucketOf(source.weight) : "normal";
  const keywords = parseKeywords(source?.archive_keywords);

  // Resolve Archive-After: source override > interest default > global (21d).
  const srcDays = source?.archive_after_days ?? 0;
  const intDays = interest?.archive_after_days ?? 0;
  const arch = resolveSourceArchive(srcDays, intDays, interest?.name);
  const resolvedDays = arch.days;

  // Averages across every source, for the "vs your average source" sublines. The
  // engagement figures use the rolling 30-day window (#120), so an absolute count
  // always carries a time range and the comparison is like-for-like.
  const all = Object.values(stats);
  const avg = (sel: (s: SourceStats) => number) => (all.length ? all.reduce((a, s) => a + sel(s), 0) / all.length : 0);
  const avgPerDay = avg((s) => s.per_day);
  // Compare against the sources you've ACTUALLY read in the window, not the whole
  // library - otherwise ~90 sources with zero recent activity drag the mean to ~1
  // and every active source reads as "15x your average". Like-for-like.
  const active30 = all.filter((s) => (s.shown_30 ?? 0) > 0);
  const avgShown30 = active30.length ? active30.reduce((a, s) => a + s.shown_30, 0) / active30.length : 0;
  const avgOpen30 = active30.length ? active30.reduce((a, s) => a + s.opened_30 / s.shown_30, 0) / active30.length : 0;

  // Open rate is the whole story (#120): a "presented" item is one actually scrolled
  // into view; everything you didn't open (skipped or left on) is simply not-opened.
  const shown30 = st?.shown_30 ?? 0;
  const openPct30 = shown30 ? (st?.opened_30 ?? 0) / shown30 : 0;
  // The one threshold-crossing insight for this source (matches the pill shown on
  // the interest page); StatIcon marks the stat line the pill was derived from.
  const insight = sourceInsight(st);
  const resolvedSince = (st?.shown_since ?? 0) + (st?.missed_since ?? 0);

  function eligible(it: SourceItem): boolean {
    return itemEligible(it.published_at, resolvedDays, keywords, `${it.title} ${it.summary}`);
  }
  function statusOf(it: SourceItem): { label: string; cls: string } {
    switch (it.state) {
      case "opened":
        return { label: "read", cls: "st-read" };
      case "liked":
        return { label: "liked", cls: "st-read" };
      case "skipped":
        return { label: "skipped", cls: "st-skip" };
      case "surfaced":
        return { label: "presented", cls: "st-pres" };
      case "saved":
        return { label: "saved", cls: "st-pres" };
      default:
        return eligible(it) ? { label: "unread", cls: "st-unread" } : { label: "auto archived", cls: "st-arch" };
    }
  }

  // statIcon marks a stat line when it's the source of the active insight pill, so
  // a user seeing "92% invisible" on the interest page finds the matching line here.
  function statIcon(kind: InsightKind) {
    if (!insight || insight.kind !== kind) return null;
    const I = kind === "open" ? Mail : kind === "skip" ? Ban : EyeOff;
    return (
      <span className={`src-stat-ico ins-${kind}`} aria-hidden>
        <I size={14} strokeWidth={1.9} />
      </span>
    );
  }

  // handlers
  async function saveRename() {
    const t = renameDraft.trim();
    if (!t) return;
    setRenameOpen(false);
    await api.updateSource(sourceId, { title: t }).catch(() => {});
    reload();
  }
  async function setWeight(b: Bucket) {
    await api.updateSource(sourceId, { weight_bucket: b }).catch(() => {});
    reload();
  }
  async function pickArchive(days: number) {
    await api.updateSource(sourceId, { archive_after_days: days }).catch(() => {});
    reload();
  }
  async function saveKeywords() {
    const list = parseKeywords(kwDraft);
    await api.updateSource(sourceId, { archive_keywords: list.join(", ") }).catch(() => {});
    reload();
  }
  async function chooseInterest(slug: string) {
    setInterestOpen(false);
    await api.setSourceInterest(sourceId, slug).catch(() => {});
    reload();
  }
  async function resetMeta() {
    setResetOpen(false);
    await api.resetSourceMetadata(sourceId).catch(() => {});
    reloadStats();
    api.sourceItems(sourceId).then(setPosts).catch(() => {});
    showToast("Metadata reset - every article is unread again.");
  }
  async function replaceUrl() {
    if (!urlDraft.trim()) return;
    setUrlOpen(false);
    await api.replaceSourceFeedURL(sourceId, urlDraft.trim()).catch(() => {});
    reload();
    showToast("Feed URL replaced.");
  }
  async function del() {
    await api.deleteSource(sourceId).catch(() => {});
    nav(source?.interest_slug ? `/interests/${source.interest_slug}` : "/sources");
  }
  function copyUrl() {
    if (source?.feed_url) navigator.clipboard?.writeText(source.feed_url).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  if (sources && !source) {
    return (
      <div className="mgmt">
        <button className="mgmt-back" onClick={() => nav("/sources")}>
          ← Library
        </button>
        <p className="lib2-empty">That source is gone.</p>
      </div>
    );
  }
  if (!source) return <p className="lib2-subtitle">Loading…</p>;

  const backTo = source.interest_slug ? `/interests/${source.interest_slug}` : "/sources";
  const backLabel = interest?.name ?? "Library";

  return (
    <div className="mgmt src-page">
      <button className="mgmt-back" onClick={() => nav(backTo)}>
        ← {backLabel}
      </button>
      <div className="mgmt-kicker">Manage Source</div>
      <div className="mgmt-titlerow">
        <h1 className="mgmt-title">{source.title}</h1>
        <button className="mgmt-edit" onClick={() => (setRenameDraft(source.title), setRenameOpen(true))}>
          <Pencil size={13} strokeWidth={1.9} aria-hidden /> rename
        </button>
      </div>

      <div className="src-rss">
        <span className="src-rss-k">RSS Feed:</span>
        <code className="src-rss-url">{source.feed_url}</code>
        <button className="src-rss-copy" onClick={copyUrl} aria-label="Copy URL">
          {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
        </button>
      </div>
      {err && <p className="err">{err}</p>}

      {/* --- transparency stats --- */}
      <div className="src-stats">
        {(st?.per_day ?? 0) > 0 ? (
          <p className="src-stat">
            {source.title} publishes about <b>{cadenceCount(scaleCadence(st!.per_day).value)}</b>{" "}
            {cadenceCount(scaleCadence(st!.per_day).value) === "1" ? "article" : "articles"} a {scaleCadence(st!.per_day).unit}.
          </p>
        ) : (
          <p className="src-stat">{source.title} hasn't published anything recently.</p>
        )}
        {(st?.per_day ?? 0) > 0 && (
          <p className="src-stat-sub">That's {compareToAverage(st?.per_day ?? 0, avgPerDay, "more content", "less content")}.</p>
        )}

        <p className="src-stat">
          In the last 30 days, <b>{shown30}</b> {shown30 === 1 ? "article was" : "articles were"} presented to you.
        </p>
        {shown30 > 0 ? (
          <>
            <p className="src-stat-sub">
              That's {compareToAverage(shown30, avgShown30, "more representation", "less representation")}.
            </p>
            <p className="src-stat">
              {statIcon("open")}
              You opened <b>{pct(openPct30)}</b> of them.
            </p>
            <p className="src-stat-sub">That open rate is {compareToAverage(openPct30, avgOpen30, "higher", "lower")}.</p>
          </>
        ) : (
          <p className="src-stat-sub">Nothing from {source.title} has come up in a session lately.</p>
        )}

        {resolvedSince > 0 ? (
          <>
            <p className="src-stat">
              {statIcon("invisible")}
              Since you added {source.title}, <b>{pct(st?.invisible_pct ?? 0)}</b> of its articles aged out before you ever
              saw them.
            </p>
            <p className="src-stat-sub">
              {st?.shown_since ?? 0} reached you, {st?.missed_since ?? 0} archived unseen.
            </p>
          </>
        ) : (
          <p className="src-stat-sub">Too new to tell how much of {source.title} you're seeing yet.</p>
        )}

        <p className="src-stat">
          There {(st?.on_deck ?? 0) === 1 ? "is" : "are"} <b>{st?.on_deck ?? 0}</b> unread{" "}
          {(st?.on_deck ?? 0) === 1 ? "article" : "articles"} on deck from {source.title}.
        </p>
      </div>

      {/* --- feed controls (read-only, edited in a dialog) --- */}
      <div className="mgmt-sechead">
        <span className="mgmt-seclabel">Feed Controls</span>
        <button className="mgmt-edit" onClick={() => (setKwDraft(keywords.join(", ")), setControlsOpen(true))}>
          <Settings size={13} strokeWidth={1.9} aria-hidden /> edit
        </button>
      </div>
      <div className="fc">
        <p className="fc-line">
          Articles are automatically <b>{resolvedDays === -1 ? "never archived" : `archived after ${arch.value}`}</b>.
        </p>
        <p className="fc-sub">
          {arch.inherited ? `Inherited from ${arch.originLabel} (${arch.value}).` : "Set for this source."}
        </p>

        <p className="fc-line">
          {source.title} is <b>{REP_PROSE[bucket]}</b>.
        </p>
        <div className="fc-rep">
          <Dots level={REP_LEVEL[bucket]} />
          <span className="fc-rep-label">{REP_LABEL[bucket]}</span>
        </div>

        {keywords.length > 0 ? (
          <>
            <p className="fc-line">Articles whose title matches any of these keywords are archived on arrival:</p>
            <div className="fc-chips">
              {keywords.map((k) => (
                <span className="fc-chip" key={k}>
                  {k}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="fc-sub">No auto-archive keywords set.</p>
        )}
      </div>

      {/* --- interest (read-only + change) --- */}
      <div className="mgmt-sechead">
        <span className="mgmt-seclabel">Interest</span>
      </div>
      <p className="fc-line">
        This source is in <b>{interest?.name ?? "no interest"}</b>.{" "}
        <button className="mgmt-inline" onClick={() => setInterestOpen(true)}>
          change
        </button>
      </p>

      {/* --- articles preview --- */}
      <div className="mgmt-sechead">
        <span className="mgmt-seclabel">Articles</span>
        <button className="mgmt-edit" onClick={() => nav(`/sources/${sourceId}/articles`)}>
          view all
        </button>
      </div>
      <div className="art-list">
        {posts === null ? (
          <p className="lib2-subtitle">Loading…</p>
        ) : posts.length === 0 ? (
          <p className="fc-sub">No articles yet.</p>
        ) : (
          posts.slice(0, 4).map((it) => {
            const s = statusOf(it);
            return (
              <div className={`art-row ${s.cls === "st-unread" ? "fresh" : ""}`} key={it.id}>
                <div className="art-main">
                  <span className="art-title">{it.title}</span>
                  <span className={`art-badge ${s.cls}`}>{s.label}</span>
                </div>
                <span className="art-date">{relDate(it.published_at)}</span>
              </div>
            );
          })
        )}
        {posts && posts.length > 4 && (
          <button className="art-more" onClick={() => nav(`/sources/${sourceId}/articles`)}>
            see more →
          </button>
        )}
      </div>

      {/* --- actions --- */}
      <div className="mgmt-sechead">
        <span className="mgmt-seclabel">Actions</span>
      </div>
      <div className="act-list">
        <button className="act-item" onClick={() => setResetOpen(true)}>
          Reset article metadata
        </button>
        <button className="act-item" onClick={() => (setUrlDraft(source.feed_url), setUrlOpen(true))}>
          Replace RSS feed URL
        </button>
        <button className="act-item danger" onClick={() => setDelOpen(true)}>
          Delete source
        </button>
      </div>

      {toast && <div className="mgmt-toast">{toast}</div>}

      {/* --- dialogs --- */}
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} kicker="Rename source">
        <input className="field" value={renameDraft} autoFocus onChange={(e) => setRenameDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveRename()} />
        <div className="dlg-actions">
          <button className="btn" onClick={saveRename} disabled={!renameDraft.trim()}>
            Save
          </button>
        </div>
      </Dialog>

      <Dialog open={controlsOpen} onClose={() => setControlsOpen(false)} kicker="Feed controls">
        <div className="dlg-sub">Representation</div>
        <div className="dlg-opts">
          {BUCKETS.slice().reverse().map((b) => (
            <button key={b} className={`dlg-opt ${bucket === b ? "on" : ""}`} onClick={() => setWeight(b)}>
              <span className="dlg-radio" aria-hidden />
              <span className="dlg-name">{REP_FREQ[b]}</span>
              <span className="dlg-sub">{REP_HINT[b]}</span>
            </button>
          ))}
        </div>
        <div className="dlg-sub">Archive after</div>
        <ArchiveChoice scope="source" value={srcDays} intDays={intDays} interestName={interest?.name} onChange={pickArchive} />
        <div className="dlg-sub">Auto-archive keywords</div>
        <input
          className="field"
          placeholder="comma, separated, keywords"
          value={kwDraft}
          onChange={(e) => setKwDraft(e.target.value)}
        />
        <p className="caphint">An article whose title contains any of these is archived on arrival.</p>
        <div className="dlg-actions">
          <button className="btn" onClick={() => (saveKeywords(), setControlsOpen(false))}>
            Done
          </button>
        </div>
      </Dialog>

      <Dialog open={interestOpen} onClose={() => setInterestOpen(false)} kicker="Move to interest">
        <div className="dlg-opts">
          {interests.map((i) => (
            <button key={i.slug} className={`dlg-opt ${source.interest_slug === i.slug ? "on" : ""}`} onClick={() => chooseInterest(i.slug)}>
              <span className="dlg-radio" aria-hidden />
              <span className="dlg-name">{i.name}</span>
            </button>
          ))}
          <button className={`dlg-opt ${!source.interest_slug ? "on" : ""}`} onClick={() => chooseInterest("")}>
            <span className="dlg-radio" aria-hidden />
            <span className="dlg-name">No interest</span>
          </button>
        </div>
      </Dialog>

      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} kicker="Reset article metadata">
        <p className="dlg-copy">
          Marks every article from {source.title} unread again and clears its engagement (presented, skipped, read). The
          articles themselves are kept.
        </p>
        <div className="dlg-actions">
          <button className="btn ghost" onClick={() => setResetOpen(false)}>
            Cancel
          </button>
          <button className="btn" onClick={resetMeta}>
            Reset
          </button>
        </div>
      </Dialog>

      <Dialog open={urlOpen} onClose={() => setUrlOpen(false)} kicker="Replace RSS feed URL">
        <p className="dlg-copy">Swap the feed URL, keeping this source's articles and settings.</p>
        <input className="field" value={urlDraft} autoFocus onChange={(e) => setUrlDraft(e.target.value)} />
        <div className="dlg-actions">
          <button className="btn ghost" onClick={() => setUrlOpen(false)}>
            Cancel
          </button>
          <button className="btn" onClick={replaceUrl} disabled={!urlDraft.trim()}>
            Replace
          </button>
        </div>
      </Dialog>

      <Dialog open={delOpen} onClose={() => setDelOpen(false)} kicker="Delete source">
        <p className="dlg-copy">
          Permanently remove {source.title} and all of its stored articles. This can't be undone.
        </p>
        <div className="dlg-actions">
          <button className="btn ghost" onClick={() => setDelOpen(false)}>
            Cancel
          </button>
          <button className="btn danger" onClick={del}>
            Delete
          </button>
        </div>
      </Dialog>
    </div>
  );
}
