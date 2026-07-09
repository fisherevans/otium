import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil, Plus, Mail, Ban, EyeOff } from "lucide-react";
import { api, type Interest, type Mix, type Source, type SourceStats } from "@/api/client";
import { FEED_ICONS, feedIcon } from "@/lib/feedIcons";
import { archiveValue, resolveInterestArchive } from "@/lib/archive";
import { cadencePhrase } from "@/lib/cadence";
import { engagementBadge, openRateBands } from "@/lib/stats";
import { ArchiveChoice } from "@/components/ArchiveChoice";
import { bucketOf, REP_LEVEL, REP_LABEL } from "@/lib/represent";
import { Dialog } from "@/components/Dialog";

// The Interest page (session engine v2, mockup #3). One interest shown plainly:
// identity (name + icon, edited in a dialog), which mix it lives in, its default
// archival period (edited in a dialog), and its sources with the engagement +
// representation facts that characterize each. Sources drill into their own page.

function Dots({ level }: { level: number }) {
  return (
    <span className="rep-dots" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`rep-dot ${i <= level ? "on" : ""}`} />
      ))}
    </span>
  );
}
function archivalSuffix(srcDays: number): string {
  if (srcDays === 0) return "";
  if (srcDays === -1) return "EVERGREEN";
  return `${archiveValue(srcDays).toUpperCase()} ARCHIVAL`;
}
function BadgeIcon({ tone }: { tone: "up" | "down" | "mute" }) {
  if (tone === "up") return <Mail size={12} strokeWidth={1.9} aria-hidden />;
  if (tone === "down") return <Ban size={12} strokeWidth={1.9} aria-hidden />;
  return <EyeOff size={12} strokeWidth={1.9} aria-hidden />;
}

export default function InterestPage() {
  const nav = useNavigate();
  const { slug } = useParams();

  const [interests, setInterests] = useState<Interest[] | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [stats, setStats] = useState<Record<number, SourceStats>>({});
  const [mixes, setMixes] = useState<Mix[]>([]);
  const [memberMixIds, setMemberMixIds] = useState<Set<number>>(new Set());
  const [err, setErr] = useState("");

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addKind, setAddKind] = useState("rss");
  const [addImport, setAddImport] = useState(true); // #122: import YT backlog on add
  const [adding, setAdding] = useState(false);

  const interest = useMemo(() => (interests ? interests.find((f) => f.slug === slug) ?? null : null), [interests, slug]);

  function reloadInterests() {
    api.interests().then(setInterests).catch((e) => setErr(String(e.message ?? e)));
  }
  function reloadSources() {
    api.sources().then(setSources).catch(() => {});
  }
  useEffect(() => {
    reloadInterests();
    reloadSources();
    api.mixes().then(setMixes).catch(() => setMixes([]));
    api.sourceStats().then(setStats).catch(() => {});
  }, []);

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
    if (interest) setEditName(interest.name);
  }, [interest?.id]);

  const interestSources = useMemo(() => {
    if (!slug) return [];
    return sources
      .filter((s) => s.interest_slug === slug)
      .sort((a, b) => b.weight - a.weight || a.title.localeCompare(b.title));
  }, [sources, slug]);

  // Open-rate percentile bands across the whole library (stats holds every source),
  // so a source's pill reflects where it ranks among all of them, not this interest.
  const bands = useMemo(() => openRateBands(Object.values(stats)), [stats]);

  async function pickArchive(days: number) {
    if (!interest) return;
    // Don't close on pick: ArchiveChoice fires onChange live (e.g. while adjusting a
    // custom window), so the dialog stays open and the user dismisses it with Done.
    await api.updateInterest(interest.id, { archive_after_days: days }).catch(() => {});
    reloadInterests();
  }
  async function saveEdit() {
    if (!interest) return;
    const name = editName.trim();
    setEditOpen(false);
    if (name && name !== interest.name) {
      await api.updateInterest(interest.id, { name }).catch(() => {});
      reloadInterests();
    }
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
      const s = await api.createSource({
        title: addTitle.trim() || addUrl,
        feed_url: addUrl.trim(),
        kind: addKind,
        ...(addKind === "youtube" ? { import_backlog: addImport } : {}),
      });
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

  if (interests && !interest) {
    return (
      <div className="mgmt">
        <button className="mgmt-back" onClick={() => nav("/sources")}>
          ← Library
        </button>
        <p className="lib2-empty">That interest doesn't exist.</p>
      </div>
    );
  }
  if (!interest) return <p className="lib2-subtitle">Loading…</p>;

  const Icon = feedIcon(interest.icon);
  const intArch = resolveInterestArchive(interest.archive_after_days ?? 0);
  const memberMixes = mixes.filter((m) => memberMixIds.has(m.id));
  const mixLine =
    memberMixes.length === 0
      ? `${interest.name} is not in a mix.`
      : `${interest.name} is a part of the ${memberMixes.map((m) => m.name).join(" and ")} ${memberMixes.length === 1 ? "mix" : "mixes"}.`;

  return (
    <div className="mgmt">
      <button className="mgmt-back" onClick={() => nav("/sources")}>
        ← Library
      </button>
      <div className="mgmt-kicker">Manage Interest</div>
      <div className="mgmt-titlerow">
        <h1 className="mgmt-title int-title">
          {Icon ? (
            <span className="int-title-glyph" aria-hidden>
              <Icon size={28} strokeWidth={1.6} />
            </span>
          ) : null}
          {interest.name}
        </h1>
        <button className="mgmt-edit" onClick={() => (setEditName(interest.name), setEditOpen(true))}>
          <Pencil size={13} strokeWidth={1.9} aria-hidden /> edit
        </button>
      </div>
      {err && <p className="err">{err}</p>}

      <p className="int-prose">{mixLine}</p>
      <p className="int-prose">
        The default archival period for {interest.name} sources is{" "}
        <button className="mgmt-inline" onClick={() => setArchiveOpen(true)}>
          {intArch.value}
        </button>
        {intArch.inherited ? `, inherited from ${intArch.originLabel}.` : "."}
      </p>

      <div className="mgmt-sechead">
        <span className="mgmt-seclabel">Sources</span>
        <button className="mgmt-edit" onClick={() => setAddOpen(true)}>
          <Plus size={15} strokeWidth={1.9} aria-hidden /> Add source
        </button>
      </div>

      {interestSources.length === 0 ? (
        <p className="fc-sub">No sources yet - add one above.</p>
      ) : (
        <div className="isrc-list">
          {interestSources.map((s) => {
            const st = stats[s.id];
            const badge = engagementBadge(st, bands);
            const b = bucketOf(s.weight);
            const pd = st?.per_day ?? 0;
            const onDeck = st?.on_deck ?? 0;
            const suffix = archivalSuffix(s.archive_after_days ?? 0);
            return (
              <button className="isrc-row" key={s.id} onClick={() => nav(`/sources/${s.id}`)}>
                <div className="isrc-head">
                  <span className="isrc-name">{s.title}</span>
                  {badge && (
                    <span className={`isrc-badge tone-${badge.tone}`}>
                      <BadgeIcon tone={badge.tone} /> {badge.text}
                    </span>
                  )}
                </div>
                <div className="isrc-sub">
                  {s.kind.toUpperCase()} · {cadencePhrase(pd)} · {onDeck > 0 ? `${onDeck} on deck` : "caught up"}
                </div>
                <div className="isrc-rep">
                  <Dots level={REP_LEVEL[b]} />
                  <span className="isrc-rep-label">
                    {REP_LABEL[b]}
                    {suffix ? ` · ${suffix}` : ""}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* --- dialogs --- */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} kicker="Edit interest">
        <div className="dlg-sub">Name</div>
        <input className="field" value={editName} autoFocus onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
        <div className="dlg-sub">Icon</div>
        <div className="icon-grid">
          <button className={`icon-cell ${!interest.icon ? "on" : ""}`} onClick={() => chooseIcon("")} aria-label="No icon">
            <span className="introw-dot" />
          </button>
          {FEED_ICONS.map((def) => {
            const I = def.Icon;
            return (
              <button
                key={def.key}
                className={`icon-cell ${interest.icon === def.key ? "on" : ""}`}
                onClick={() => chooseIcon(def.key)}
                aria-label={def.label}
                title={def.label}
              >
                {I && <I size={20} strokeWidth={1.6} />}
              </button>
            );
          })}
        </div>
        <div className="dlg-actions">
          <button className="btn" onClick={saveEdit}>
            Done
          </button>
        </div>
      </Dialog>

      <Dialog open={archiveOpen} onClose={() => setArchiveOpen(false)} kicker="Default archival period">
        <p className="caphint">Sources in {interest.name} inherit this unless they set their own.</p>
        <ArchiveChoice scope="interest" value={interest.archive_after_days ?? 0} onChange={pickArchive} />
        <div className="dlg-actions">
          <button className="btn" onClick={() => setArchiveOpen(false)}>
            Done
          </button>
        </div>
      </Dialog>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} kicker="Add source">
        <div className="dlg-sub">Feed URL</div>
        <input className="field" placeholder="https://example.com/feed" value={addUrl} autoFocus onChange={(e) => setAddUrl(e.target.value)} />
        <div className="dlg-sub">Name (optional)</div>
        <input className="field" placeholder="e.g. Seven Days" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} />
        <div className="dlg-sub">Kind</div>
        <div className="dlg-opts">
          {["rss", "youtube", "podcast"].map((k) => (
            <button key={k} className={`dlg-opt ${addKind === k ? "on" : ""}`} onClick={() => setAddKind(k)}>
              <span className="dlg-radio" aria-hidden />
              <span className="dlg-name">{k}</span>
            </button>
          ))}
        </div>
        {addKind === "youtube" && (
          <button className={`dlg-opt ${addImport ? "on" : ""}`} onClick={() => setAddImport((v) => !v)}>
            <span className="dlg-check" aria-hidden>
              {addImport ? "✓" : ""}
            </span>
            <span className="dlg-name">Import full history</span>
            <span className="dlg-sub">back to this source's archive window</span>
          </button>
        )}
        <div className="dlg-actions">
          <button className="btn" onClick={addSource} disabled={adding || !addUrl.trim()}>
            {adding ? "Adding…" : "Add source"}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
