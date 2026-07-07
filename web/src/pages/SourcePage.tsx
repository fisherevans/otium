import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Interest, type Item, type Source, type SourceStats } from "@/api/client";
import { bucketOf, type Bucket } from "@/lib/weight";
import { archiveLabel } from "@/lib/archive";
import { relTime } from "@/lib/format";
import { feedIcon } from "@/lib/feedIcons";
import { WeightControl } from "@/components/WeightControl";
import { BottomSheet } from "@/components/BottomSheet";
import { ArchivePicker } from "@/components/ArchivePicker";

// The Source page (session engine v2). A dense single scroll: the transparency
// stats block up top (plain English), the feed controls (archival period,
// representation, auto-archive keywords, interest), a short article preview that
// links to the full list, and the destructive/utility actions. Reached from the
// interest page; management for one source lives entirely here.
function parseKeywords(s?: string): string[] {
  return (s ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export default function SourcePage() {
  const nav = useNavigate();
  const { id } = useParams();
  const sourceId = Number(id);

  const [sources, setSources] = useState<Source[] | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [stats, setStats] = useState<Record<number, SourceStats>>({});
  const [posts, setPosts] = useState<Item[] | null>(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  // Local, optimistic control state (the list endpoint doesn't echo archival fields).
  const [bucket, setBucket] = useState<Bucket>("normal");
  const [archiveDays, setArchiveDays] = useState(0);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [interestSlug, setInterestSlug] = useState("");

  // modals / confirms
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [kwOpen, setKwOpen] = useState(false);
  const [kwDraft, setKwDraft] = useState("");
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneTitle, setCloneTitle] = useState("");
  const [cloning, setCloning] = useState(false);

  const source = useMemo(
    () => (sources ? sources.find((s) => s.id === sourceId) ?? null : null),
    [sources, sourceId],
  );
  const st = stats[sourceId];

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
    if (!sourceId) return;
    api.sourceItems(sourceId).then(setPosts).catch(() => {});
  }, [sourceId]);

  useEffect(() => {
    if (!source) return;
    setBucket(bucketOf(source.weight));
    setArchiveDays(source.archive_after_days ?? 0);
    setKeywords(parseKeywords(source.archive_keywords));
    setInterestSlug(source.interest_slug ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }

  async function setWeight(b: Bucket) {
    setBucket(b);
    await api.updateSource(sourceId, { weight_bucket: b }).catch(() => {});
    reload();
  }
  async function pickArchive(days: number) {
    setArchiveDays(days);
    await api.updateSource(sourceId, { archive_after_days: days }).catch(() => {});
  }
  async function saveKeywords() {
    const list = parseKeywords(kwDraft);
    setKeywords(list);
    setKwOpen(false);
    await api.updateSource(sourceId, { archive_keywords: list.join(", ") }).catch(() => {});
  }
  async function chooseInterest(slug: string) {
    const next = interestSlug === slug ? "" : slug;
    setInterestSlug(next);
    await api.setSourceInterest(sourceId, next).catch(() => {});
    reload();
  }
  async function resetMeta() {
    setConfirmReset(false);
    await api.resetSourceMetadata(sourceId).catch(() => {});
    reloadStats();
    showToast("Metadata reset - every article is unread again");
  }
  async function replaceUrl() {
    if (!urlDraft.trim()) return;
    setUrlOpen(false);
    await api.replaceSourceFeedURL(sourceId, urlDraft.trim()).catch(() => {});
    reload();
    showToast("Feed URL replaced");
  }
  async function del() {
    await api.deleteSource(sourceId).catch(() => {});
    nav(interestSlug ? `/interests/${interestSlug}` : "/sources");
  }
  async function clone() {
    if (!cloneUrl.trim() || cloning) return;
    setCloning(true);
    try {
      const created = await api.createSource({
        title: cloneTitle.trim() || cloneUrl,
        feed_url: cloneUrl.trim(),
        kind: source?.kind,
        weight: source?.weight,
      });
      // Carry over this source's settings.
      await api.updateSource(created.id, {
        weight_bucket: bucket,
        archive_after_days: archiveDays,
        archive_keywords: keywords.join(", "),
      }).catch(() => {});
      if (interestSlug) await api.setSourceInterest(created.id, interestSlug).catch(() => {});
      setCloneOpen(false);
      setCloneUrl("");
      setCloneTitle("");
      nav(`/sources/${created.id}`);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setCloning(false);
    }
  }

  const back = (
    <button className="lib-back" onClick={() => nav(interestSlug ? `/interests/${interestSlug}` : "/sources")}>
      <span aria-hidden>←</span> {interestSlug || "Library"}
    </button>
  );

  if (sources && !source) {
    return (
      <div>
        {back}
        <p className="sub" style={{ padding: "16px 0" }}>That source isn't here anymore.</p>
      </div>
    );
  }
  if (!source) {
    return (
      <div>
        {back}
        {err ? <p className="err">{err}</p> : <p className="sub">Loading…</p>}
      </div>
    );
  }

  const pd = st?.per_day ?? source.posts_per_day ?? 0;
  const skip = Math.round((st?.skip_pct ?? 0) * 100);
  const preview = (posts ?? []).slice(0, 4);

  return (
    <div>
      {back}
      <div className="lib-topbar">
        <h1 className="display">{source.title}</h1>
      </div>

      {/* Stats block - plain English transparency. */}
      <div className="stat-block">
        <p className="stat-lead">
          {source.title} publishes about <b>{pd < 1 ? pd.toFixed(1) : Math.round(pd)}</b>{" "}
          {pd === 1 ? "article" : "articles"} a day.
        </p>
        {st && (
          <ul className="stat-list">
            <li><b>{st.shown}</b> presented to you</li>
            <li>you skipped <b>{skip}%</b> of those</li>
            <li><b>{st.invisible}</b> never shown</li>
            <li><b>{st.on_deck}</b> on deck now</li>
          </ul>
        )}
      </div>
      {source.fetch_error && <p className="err">Fetch error: {source.fetch_error}</p>}

      {/* Feed controls. */}
      <div className="page-section">
        <div className="ctl-label">Archive after</div>
        <button className="ctl-pickrow" onClick={() => setArchiveOpen(true)}>
          <span className="ctl-pickval">{archiveLabel(archiveDays, "source").replace(/^its /, "")}</span>
          <span className="sheet-chev" aria-hidden>▸</span>
        </button>
        <p className="caphint">
          {archiveDays === 0
            ? "Follows this source's interest, then the global default."
            : archiveDays === -1
            ? "Evergreen - articles never expire from sessions."
            : "Overrides the interest default for this source."}
        </p>

        <div className="ctl-label">Representation</div>
        <WeightControl value={bucket} onChange={setWeight} />

        <div className="ctl-label">Auto-archive keywords</div>
        {keywords.length === 0 ? (
          <p className="caphint" style={{ margin: "2px 0 8px" }}>
            None. Articles whose title matches a keyword are archived on arrival.
          </p>
        ) : (
          <div className="kw-chips">
            {keywords.map((k) => (
              <span className="kw-chip" key={k}>{k}</span>
            ))}
          </div>
        )}
        <button
          className="ctl-textbtn"
          onClick={() => {
            setKwDraft(keywords.join(", "));
            setKwOpen(true);
          }}
        >
          {keywords.length ? "Edit keywords" : "Add keywords"}
        </button>

        {interests.length > 0 && (
          <>
            <div className="ctl-label">Interest</div>
            <div className="interest-assign">
              {interests.map((f) => {
                const Ic = feedIcon(f.icon);
                return (
                  <button
                    key={f.slug}
                    className={`fa-chip ${interestSlug === f.slug ? "on" : ""}`}
                    onClick={() => chooseInterest(f.slug)}
                  >
                    {Ic && <Ic size={13} strokeWidth={1.75} aria-hidden />}
                    {f.name}
                  </button>
                );
              })}
            </div>
            <p className="caphint">
              A source belongs to one interest. Tap a interest to move it{interestSlug ? "; tap the current one to clear it" : ""}.
            </p>
          </>
        )}
      </div>

      {/* Articles preview. */}
      <div className="page-section">
        <div className="lib-controls" style={{ marginBottom: 8 }}>
          <span className="lib-lbl">Recent articles</span>
          <button className="lib-fsbtn" onClick={() => nav(`/sources/${sourceId}/articles`)}>
            View all
          </button>
        </div>
        {preview.length === 0 ? (
          <p className="sub" style={{ padding: "6px 0" }}>No articles fetched yet.</p>
        ) : (
          preview.map((it) => (
            <div className="lib-row" key={it.id}>
              <div className="lib-head" onClick={() => nav(`/sources/${sourceId}/articles`)}>
                <div className="nm">
                  <b>{it.title}</b>
                  <span>{it.media_type}{it.published_at ? ` · ${relTime(it.published_at)}` : ""}</span>
                </div>
                <span className="chev">▸</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Actions. */}
      <div className="page-section">
        <div className="ctl-label">Actions</div>
        {confirmReset ? (
          <div className="confirm">
            Reset your engagement metadata for {source.title}? Every article becomes unread again.
            <div className="lib-actions">
              <button onClick={() => setConfirmReset(false)}>Cancel</button>
              <button onClick={resetMeta}>Reset</button>
            </div>
          </div>
        ) : confirmDel ? (
          <div className="confirm">
            Delete {source.title} for good? This can't be undone.
            <div className="lib-actions">
              <button onClick={() => setConfirmDel(false)}>Cancel</button>
              <button onClick={del}>Delete</button>
            </div>
          </div>
        ) : (
          <>
            <div className="lib-actions">
              <button onClick={() => setConfirmReset(true)}>Reset metadata</button>
              <button onClick={() => { setUrlDraft(source.feed_url); setUrlOpen(true); }}>Replace URL</button>
            </div>
            <div className="lib-actions">
              <button onClick={() => { setCloneTitle(""); setCloneUrl(""); setCloneOpen(true); }}>
                New source like this
              </button>
              <button onClick={() => setConfirmDel(true)}>Delete</button>
            </div>
            {source.homepage_url && (
              <div className="lib-actions">
                <button onClick={() => window.open(source.homepage_url, "_blank", "noopener")}>Visit site</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* --- modals --- */}
      <ArchivePicker
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        value={archiveDays}
        scope="source"
        onPick={pickArchive}
      />

      <BottomSheet open={kwOpen} onClose={() => setKwOpen(false)} kicker="Auto-archive keywords">
        <div className="sheet-title">Keywords for {source.title}</div>
        <div className="lib-add">
          <input
            className="field"
            placeholder="e.g. sponsored, giveaway, live"
            value={kwDraft}
            autoFocus
            onChange={(e) => setKwDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveKeywords()}
          />
          <button className="btn" onClick={saveKeywords}>Save keywords</button>
        </div>
        <p className="caphint">Comma-separated. An article whose title contains any keyword is archived when it arrives.</p>
      </BottomSheet>

      <BottomSheet open={urlOpen} onClose={() => setUrlOpen(false)} kicker="Replace feed URL">
        <div className="sheet-title">Replace the RSS URL</div>
        <div className="lib-add">
          <input className="field" value={urlDraft} autoFocus onChange={(e) => setUrlDraft(e.target.value)} />
          <button className="btn" onClick={replaceUrl} disabled={!urlDraft.trim()}>Replace &amp; re-fetch</button>
        </div>
        <p className="caphint">Swaps the feed this source pulls from and re-fetches it once. Its history stays.</p>
      </BottomSheet>

      <BottomSheet open={cloneOpen} onClose={() => setCloneOpen(false)} kicker="New source like this">
        <div className="sheet-title">Create a source based on {source.title}</div>
        <div className="lib-add">
          <input className="field" placeholder="Feed URL (RSS / Atom / YouTube)" value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)} />
          <input className="field" placeholder="Title (optional)" value={cloneTitle} onChange={(e) => setCloneTitle(e.target.value)} />
          <button className="btn" onClick={clone} disabled={cloning || !cloneUrl.trim()}>
            {cloning ? "Creating…" : "Create source"}
          </button>
        </div>
        <p className="caphint">
          Copies this source's representation, archival period, keywords, and interest onto a new feed URL.
        </p>
      </BottomSheet>

      {toast && (
        <div className="toast">
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
