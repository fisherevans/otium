import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil, Plus, Mail, Ban, EyeOff } from "lucide-react";
import { api, type Topic, type Section, type Source, type SourceStats } from "@/api/client";
import { FEED_ICONS, feedIcon } from "@/lib/feedIcons";
import { archiveValue, resolveTopicArchive } from "@/lib/archive";
import { cadencePhrase } from "@/lib/cadence";
import { engagementBadge, openRateBands } from "@/lib/stats";
import { ArchiveChoice } from "@/components/ArchiveChoice";
import { bucketOf, REP_LEVEL, REP_LABEL } from "@/lib/represent";
import { Dialog } from "@/components/Dialog";
import { AddSourceWizard } from "@/components/AddSourceWizard";

// The Topic page (session engine v2, mockup #3). One topic shown plainly:
// identity (name + icon, edited in a dialog), which section it lives in, its default
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

export default function TopicPage() {
  const nav = useNavigate();
  const { slug } = useParams();

  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [stats, setStats] = useState<Record<number, SourceStats>>({});
  const [sections, setSections] = useState<Section[]>([]);
  const [memberSectionIds, setMemberSectionIds] = useState<Set<number>>(new Set());
  const [err, setErr] = useState("");

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  // #126/#127: the stepped add-source wizard. ytAvailable gates the YouTube type.
  const [ytAvailable, setYtAvailable] = useState(false);

  const topic = useMemo(() => (topics ? topics.find((f) => f.slug === slug) ?? null : null), [topics, slug]);

  function reloadTopics() {
    api.topics().then(setTopics).catch((e) => setErr(String(e.message ?? e)));
  }
  function reloadSources() {
    // Guard against a null body (Go marshals an empty slice as JSON null): a null
    // here would white-screen the page on the sources.filter memo (#126).
    api.sources().then((s) => setSources(s ?? [])).catch(() => {});
  }
  useEffect(() => {
    reloadTopics();
    reloadSources();
    api.sections().then(setSections).catch(() => setSections([]));
    api.sourceStats().then(setStats).catch(() => {});
    api.getConfig().then((c) => setYtAvailable(c.youtube_available)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!topic || sections.length === 0) {
      setMemberSectionIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      const ids = new Set<number>();
      await Promise.all(
        sections.map(async (m) => {
          const b = await api.sectionBrowse(m.id).catch(() => null);
          if (b && b.topics.some((f) => f.id === topic.id)) ids.add(m.id);
        }),
      );
      if (!cancelled) setMemberSectionIds(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, [topic?.id, sections]);

  useEffect(() => {
    if (topic) setEditName(topic.name);
  }, [topic?.id]);

  const topicSources = useMemo(() => {
    if (!slug) return [];
    return sources
      .filter((s) => s.topic_slug === slug)
      .sort((a, b) => b.weight - a.weight || a.title.localeCompare(b.title));
  }, [sources, slug]);

  // Open-rate percentile bands across the whole library (stats holds every source),
  // so a source's pill reflects where it ranks among all of them, not this topic.
  const bands = useMemo(() => openRateBands(Object.values(stats)), [stats]);

  async function pickArchive(days: number) {
    if (!topic) return;
    // Don't close on pick: ArchiveChoice fires onChange live (e.g. while adjusting a
    // custom window), so the dialog stays open and the user dismisses it with Done.
    await api.updateTopic(topic.id, { archive_after_days: days }).catch(() => {});
    reloadTopics();
  }
  async function saveEdit() {
    if (!topic) return;
    const name = editName.trim();
    setEditOpen(false);
    if (name && name !== topic.name) {
      await api.updateTopic(topic.id, { name }).catch(() => {});
      reloadTopics();
    }
  }
  async function chooseIcon(key: string) {
    if (!topic) return;
    const next = topic.icon === key ? "" : key;
    await api.updateTopic(topic.id, { icon: next }).catch(() => {});
    reloadTopics();
  }
  async function setHalfLife(days: number) {
    if (!topic) return;
    await api.updateTopic(topic.id, { half_life_days: days }).catch(() => {});
    reloadTopics();
  }
  function onSourceAdded() {
    reloadSources();
    reloadTopics();
    api.sourceStats().then(setStats).catch(() => {});
  }

  if (topics && !topic) {
    return (
      <div className="mgmt">
        <button className="mgmt-back" onClick={() => nav("/sections")}>
          ← Library
        </button>
        <p className="lib2-empty">That topic doesn't exist.</p>
      </div>
    );
  }
  if (!topic) return <p className="lib2-subtitle">Loading…</p>;

  const Icon = feedIcon(topic.icon);
  const intArch = resolveTopicArchive(topic.archive_after_days ?? 0);
  const memberSections = sections.filter((m) => memberSectionIds.has(m.id));
  const sectionLine =
    memberSections.length === 0
      ? `${topic.name} is not in a section.`
      : `${topic.name} is a part of the ${memberSections.map((m) => m.name).join(" and ")} ${memberSections.length === 1 ? "section" : "sections"}.`;

  return (
    <div className="mgmt">
      <button className="mgmt-back" onClick={() => nav("/sections")}>
        ← Library
      </button>
      <div className="mgmt-kicker">Manage Topic</div>
      <div className="mgmt-titlerow">
        <h1 className="mgmt-title int-title">
          {Icon ? (
            <span className="int-title-glyph" aria-hidden>
              <Icon size={28} strokeWidth={1.6} />
            </span>
          ) : null}
          {topic.name}
        </h1>
        <button className="mgmt-edit" onClick={() => (setEditName(topic.name), setEditOpen(true))}>
          <Pencil size={13} strokeWidth={1.9} aria-hidden /> edit
        </button>
      </div>
      {err && <p className="err">{err}</p>}

      <p className="int-prose">{sectionLine}</p>
      <p className="int-prose">
        The default archival period for {topic.name} sources is{" "}
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

      {topicSources.length === 0 ? (
        <p className="fc-sub">No sources yet - add one above.</p>
      ) : (
        <div className="isrc-list">
          {topicSources.map((s) => {
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
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} kicker="Edit topic">
        <div className="dlg-sub">Name</div>
        <input className="field" value={editName} autoFocus onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
        <div className="dlg-sub">Icon</div>
        <div className="icon-grid">
          <button className={`icon-cell ${!topic.icon ? "on" : ""}`} onClick={() => chooseIcon("")} aria-label="No icon">
            <span className="introw-dot" />
          </button>
          {FEED_ICONS.map((def) => {
            const I = def.Icon;
            return (
              <button
                key={def.key}
                className={`icon-cell ${topic.icon === def.key ? "on" : ""}`}
                onClick={() => chooseIcon(def.key)}
                aria-label={def.label}
                title={def.label}
              >
                {I && <I size={20} strokeWidth={1.6} />}
              </button>
            );
          })}
        </div>
        <div className="dlg-sub">Freshness half-life</div>
        <p className="caphint">How fast articles in {topic.name} lose ranking as they age. 0 = use the global default.</p>
        <div className="dlg-opts">
          {[
            { d: 0, label: "Global default" },
            { d: 3, label: "3 days" },
            { d: 7, label: "1 week" },
            { d: 14, label: "2 weeks" },
            { d: 30, label: "1 month" },
          ].map((h) => (
            <button
              key={h.d}
              className={`dlg-opt ${(topic.half_life_days ?? 0) === h.d ? "on" : ""}`}
              onClick={() => setHalfLife(h.d)}
            >
              <span className="dlg-radio" aria-hidden />
              <span className="dlg-name">{h.label}</span>
            </button>
          ))}
        </div>
        <div className="dlg-actions">
          <button className="btn" onClick={saveEdit}>
            Done
          </button>
        </div>
      </Dialog>

      <Dialog open={archiveOpen} onClose={() => setArchiveOpen(false)} kicker="Default archival period">
        <p className="caphint">Sources in {topic.name} inherit this unless they set their own.</p>
        <ArchiveChoice scope="topic" value={topic.archive_after_days ?? 0} onChange={pickArchive} />
        <div className="dlg-actions">
          <button className="btn" onClick={() => setArchiveOpen(false)}>
            Done
          </button>
        </div>
      </Dialog>

      {topic && (
        <AddSourceWizard
          open={addOpen}
          topic={topic}
          ytAvailable={ytAvailable}
          onClose={() => setAddOpen(false)}
          onAdded={onSourceAdded}
        />
      )}
    </div>
  );
}
