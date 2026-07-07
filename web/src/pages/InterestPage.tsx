import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { api, type Interest, type Mix, type Source, type SourceStats } from "@/api/client";
import { FEED_ICONS, feedIcon } from "@/lib/feedIcons";
import { archiveLabel, archiveShort } from "@/lib/archive";
import { engagementBadge, sourceSubline } from "@/lib/stats";
import { WeightIndicator } from "@/components/WeightIndicator";
import { BottomSheet } from "@/components/BottomSheet";
import { ArchivePicker } from "@/components/ArchivePicker";

// The Interest page (session engine v2). One interest, shown plainly: its identity
// (name + icon, editable), which mix it lives in, its default archival period, and
// its sources with the engagement + representation facts that characterize each.
// Sources drill into their own page; management that isn't rename/archival happens
// there. Full page, not a modal - modals are reserved for rename + archival period.
export default function InterestPage() {
  const nav = useNavigate();
  const { slug } = useParams();

  const [interests, setInterests] = useState<Interest[] | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [stats, setStats] = useState<Record<number, SourceStats>>({});
  const [mixes, setMixes] = useState<Mix[]>([]);
  const [memberMixIds, setMemberMixIds] = useState<Set<number>>(new Set());
  const [err, setErr] = useState("");

  // Archival period is not returned by the list endpoint yet, so track the current
  // value locally (seeded from the interest, then optimistic on edit).
  const [archiveDays, setArchiveDays] = useState(0);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [iconQ, setIconQ] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addKind, setAddKind] = useState("rss");
  const [adding, setAdding] = useState(false);

  const interest = useMemo(
    () => (interests ? interests.find((f) => f.slug === slug) ?? null : null),
    [interests, slug],
  );

  function reloadInterests() {
    api.interests().then(setInterests).catch((e) => setErr(String(e.message ?? e)));
  }
  function reloadSources() {
    api.sources().then(setSources).catch(() => {});
  }
  async function reloadMixes() {
    const ms = await api.mixes().catch(() => [] as Mix[]);
    setMixes(ms);
  }
  useEffect(() => {
    reloadInterests();
    reloadSources();
    reloadMixes();
    api.sourceStats().then(setStats).catch(() => {});
  }, []);

  // Which mixes contain this interest (for the "part of {mix}" line).
  useEffect(() => {
    if (!interest || mixes.length === 0) {
      setMemberMixIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      const ids = new Set<number>();
      await Promise.all(
        mixes.map(async (m) => {
          const b = await api.mixBrowse(m.id).catch(() => null);
          if (b && b.interests.some((f) => f.id === interest.id)) ids.add(m.id);
        }),
      );
      if (!cancelled) setMemberMixIds(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, [interest?.id, mixes]);

  useEffect(() => {
    if (!interest) return;
    setArchiveDays(interest.archive_after_days ?? 0);
    setEditName(interest.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interest?.id]);

  const interestSources = useMemo(() => {
    if (!slug) return [];
    return sources
      .filter((s) => s.interest_slug === slug)
      .sort((a, b) => {
        const aa = a.state === "archived" ? 1 : 0;
        const ba = b.state === "archived" ? 1 : 0;
        return aa - ba || b.weight - a.weight || a.title.localeCompare(b.title);
      });
  }, [sources, slug]);

  async function pickArchive(days: number) {
    if (!interest) return;
    setArchiveDays(days); // optimistic (list endpoint doesn't echo it back)
    await api.updateInterest(interest.id, { archive_after_days: days }).catch(() => {});
  }
  async function saveName() {
    if (!interest) return;
    const name = editName.trim();
    if (!name || name === interest.name) return;
    await api.updateInterest(interest.id, { name }).catch(() => {});
    reloadInterests();
  }
  async function chooseIcon(key: string) {
    if (!interest) return;
    const next = interest.icon === key ? "" : key;
    await api.updateInterest(interest.id, { icon: next }).catch(() => {});
    reloadInterests();
  }
  async function addSource() {
    if (!addUrl.trim() || !interest || adding) return;
    setAdding(true);
    try {
      const s = await api.createSource({ title: addTitle.trim() || addUrl, feed_url: addUrl.trim(), kind: addKind });
      await api.setSourceInterest(s.id, interest.slug).catch(() => {});
      setAddUrl("");
      setAddTitle("");
      setAddOpen(false);
      reloadSources();
      reloadInterests();
      api.sourceStats().then(setStats).catch(() => {});
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setAdding(false);
    }
  }

  const back = (
    <button className="lib-back" onClick={() => nav("/sources")}>
      <span aria-hidden>←</span> Library
    </button>
  );

  if (interests && !interest) {
    return (
      <div>
        {back}
        <p className="sub" style={{ padding: "16px 0" }}>That interest doesn't exist.</p>
      </div>
    );
  }
  if (!interest) {
    return (
      <div>
        {back}
        {err ? <p className="err">{err}</p> : <p className="sub">Loading…</p>}
      </div>
    );
  }

  const HeadIc = feedIcon(interest.icon);
  const memberMixes = mixes.filter((m) => memberMixIds.has(m.id));
  const query = iconQ.trim().toLowerCase();
  const shownIcons = query
    ? FEED_ICONS.filter((d) => d.label.toLowerCase().includes(query) || d.key.includes(query))
    : FEED_ICONS;

  return (
    <div>
      {back}
      <div className="lib-topbar">
        <h1 className="display">
          {HeadIc && <HeadIc size={22} strokeWidth={1.75} aria-hidden style={{ verticalAlign: "-3px", marginRight: 8 }} />}
          {interest.name}
        </h1>
        <div className="lib-topbar-actions">
          <button className="int-edit" onClick={() => setEditOpen(true)} aria-label="Edit interest">
            <Pencil size={13} strokeWidth={1.75} aria-hidden /> Edit
          </button>
        </div>
      </div>

      {/* Plain-English facts up top (transparency). */}
      <p className="int-fact">
        {memberMixes.length > 0 ? (
          <>Part of the <b>{memberMixes.map((m) => m.name).join(", ")}</b> {memberMixes.length === 1 ? "mix" : "mixes"}.</>
        ) : (
          <>Not in a mix.</>
        )}
      </p>
      <p className="int-fact">
        The default archival period for {interest.name} sources is{" "}
        <button className="int-inline-edit" onClick={() => setArchiveOpen(true)}>
          {archiveLabel(archiveDays, "interest")}
        </button>
        .
      </p>
      {err && <p className="err">{err}</p>}

      {/* Sources in this interest. */}
      <div className="page-section">
        <div className="lib-controls" style={{ marginBottom: 8 }}>
          <span className="lib-lbl">Sources</span>
          <span className="lib-count">{interestSources.length}</span>
        </div>
        {interestSources.length === 0 ? (
          <p className="sub" style={{ padding: "6px 0" }}>No sources here yet. Add one below.</p>
        ) : (
          interestSources.map((s) => {
            const st = stats[s.id];
            const badge = engagementBadge(st);
            const arch = s.archive_after_days ?? 0;
            return (
              <div className="lib-row" key={s.id}>
                <div className="lib-head srcrow" onClick={() => nav(`/sources/${s.id}`)}>
                  <div className="nm">
                    <div className="srcrow-title">
                      <b>{s.title}</b>
                      <span className={`eng-badge ${badge.tone}`}>{badge.text}</span>
                    </div>
                    <span className="srcrow-sub">
                      {sourceSubline(s.kind, st)}
                      {s.state === "archived" ? " · archived" : ""}
                    </span>
                    <div className="srcrow-indi">
                      <WeightIndicator weight={s.weight} />
                      <span className="srcrow-arch">
                        archive: {arch === 0 ? "default" : archiveShort(arch).toLowerCase()}
                      </span>
                    </div>
                  </div>
                  <span className="chev">▸</span>
                </div>
              </div>
            );
          })
        )}
        <button className="lib-addrow" onClick={() => setAddOpen(true)}>
          <span className="int-glyph" aria-hidden>+</span>
          <span>Add source</span>
        </button>
      </div>

      {/* --- modals --- */}
      <ArchivePicker
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        value={archiveDays}
        scope="interest"
        onPick={pickArchive}
      />

      <BottomSheet open={editOpen} onClose={() => setEditOpen(false)} variant="tall" kicker="Edit interest">
        <div className="sheet-title">Rename &amp; icon</div>
        <div className="ctl-label">Name</div>
        <div className="lib-add">
          <input
            className="field"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
          />
        </div>
        <div className="ctl-label">Icon</div>
        <input className="field" placeholder="Search icons…" value={iconQ} onChange={(e) => setIconQ(e.target.value)} />
        <div className="icon-grid">
          {shownIcons.map((d) => (
            <button
              key={d.key}
              className={`icon-cell ${interest.icon === d.key ? "on" : ""}`}
              title={d.label}
              aria-label={d.label}
              onClick={() => chooseIcon(d.key)}
            >
              <d.Icon size={20} strokeWidth={1.75} aria-hidden />
            </button>
          ))}
          {shownIcons.length === 0 && <p className="caphint">No icons match “{iconQ}”.</p>}
        </div>
        <p className="caphint">Tap the current icon again to clear it (falls back to the color swatch).</p>
      </BottomSheet>

      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} kicker="Add source">
        <div className="sheet-title">Add a source to {interest.name}</div>
        <div className="lib-add">
          <input className="field" placeholder="Feed URL (RSS / Atom / YouTube)" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} />
          <input className="field" placeholder="Title (optional)" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} />
          <select className="field" value={addKind} onChange={(e) => setAddKind(e.target.value)}>
            <option value="rss">RSS / blog / news</option>
            <option value="youtube">YouTube channel</option>
            <option value="podcast">Podcast</option>
          </select>
          <button className="btn" onClick={addSource} disabled={adding || !addUrl.trim()}>
            {adding ? "Adding…" : "Add source"}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
