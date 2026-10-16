import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Pencil, Plus, ChevronRight, ArrowRightLeft } from "lucide-react";
import { api, type Topic, type Section } from "@/api/client";
import { feedIcon, FEED_ICONS } from "@/lib/feedIcons";
import { Dialog } from "@/components/Dialog";
import { AddSourceWizard } from "@/components/AddSourceWizard";
import { HowItWorks } from "@/components/HowItWorks";

// The Library landing (#131, strict Section>Topic>Source tree). Sections group
// topics one-to-many; each section lists its topics. Tap a topic to manage it, or
// use "move" to reassign it. No drag - an explicit Move dialog reads calmer and
// works on touch. Add a section/topic + rename/delete/icon happen in dialogs. This
// replaced the old flat /sources library page.
export default function SectionsPage() {
  const nav = useNavigate();
  const location = useLocation();
  const returnTo = typeof location.state?.returnTo === "string" && /^\/session\/[^/]+$/.test(location.state.returnTo) ? location.state.returnTo : null;
  const [sections, setSections] = useState<Section[] | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [err, setErr] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [organizing, setOrganizing] = useState(false);
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [destinationName, setDestinationName] = useState("");
  const [destinationSection, setDestinationSection] = useState("");
  const [sourceTopic, setSourceTopic] = useState<Topic | null>(null);
  const [ytAvailable, setYtAvailable] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [addTopicOpen, setAddTopicOpen] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [renameFor, setRenameFor] = useState<Section | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [moveFor, setMoveFor] = useState<Topic | null>(null);

  async function reload() {
    setErr("");
    try {
      const [ss, ts] = await Promise.all([api.sections(), api.topics()]);
      setSections(ss ?? []);
      setTopics(ts ?? []);
    } catch (e: any) { setErr(String(e.message ?? e)); }
  }
  useEffect(() => { void reload(); api.getConfig().then((c) => setYtAvailable(c.youtube_available)).catch(() => {}); }, []);

  async function save(action: () => Promise<unknown>, done: () => void, message = "Saved") {
    if (saving) return;
    setSaving(true);
    setFormError("");
    setNotice("");
    try { await action(); done(); setNotice(message); await reload(); }
    catch (e: any) { setFormError(String(e.message ?? e)); }
    finally { setSaving(false); }
  }

  async function chooseDestination() {
    if (destination === "new") {
      const name = destinationName.trim();
      if (!name) return;
      await save(async () => {
        const topic = await api.createTopic(name, undefined, destinationSection ? Number(destinationSection) : undefined);
        setSourceTopic(topic);
      }, () => { setDestinationOpen(false); setDestinationName(""); }, "Topic created");
    } else {
      const topic = topics.find((t) => t.slug === destination);
      if (topic) { setSourceTopic(topic); setDestinationOpen(false); }
    }
  }

  // Group topics under their section (strict tree: each topic has exactly one).
  const bySection = useMemo(() => {
    const m = new Map<number, Topic[]>();
    for (const t of topics) {
      const sid = t.section_id ?? -1;
      if (!m.has(sid)) m.set(sid, []);
      m.get(sid)!.push(t);
    }
    return m;
  }, [topics]);

  async function create() {
    if (!newName.trim()) return;
    await save(() => api.createSection(newName.trim()), () => { setAddOpen(false); setNewName(""); }, "Section added");
  }
  async function createTopic() {
    if (!newTopic.trim()) return;
    await save(() => api.createTopic(newTopic.trim()), () => { setAddTopicOpen(false); setNewTopic(""); }, "Topic added");
  }
  async function chooseSectionIcon(key: string) {
    if (!renameFor) return;
    const next = renameFor.icon === key ? "" : key;
    await save(() => api.updateSection(renameFor.id, { icon: next }), () => setRenameFor((m) => m ? { ...m, icon: next } : m));
  }
  async function saveRename() {
    if (!renameFor || !renameDraft.trim()) return;
    await save(() => api.updateSection(renameFor.id, { name: renameDraft.trim() }), () => setRenameFor(null));
  }
  async function del() {
    if (!renameFor) return;
    await save(() => api.deleteSection(renameFor.id), () => setRenameFor(null), "Section deleted; its topics are in Uncategorized");
  }
  async function moveTopic(sectionId: number) {
    if (!moveFor) return;
    await save(() => api.moveTopicToSection(moveFor.id, sectionId), () => setMoveFor(null), "Topic moved");
  }
  const formStatus = <>{formError && <p className="err" role="alert">{formError}</p>}{saving ? <p role="status">Saving…</p> : notice ? <p role="status">{notice}</p> : null}</>;

  function TopicRow(f: Topic) {
    const I = feedIcon(f.icon);
    return (
      <div className="sec-topic" key={f.id}>
        <button className="sec-topic-main" onClick={() => nav(`/topics/${f.slug}`)}>
          <span className="sec-topic-glyph" aria-hidden>
            {I ? <I size={18} strokeWidth={1.6} /> : <span className="introw-dot" />}
          </span>
          <span className="sec-topic-name">{f.name}</span>
          <span className="sec-topic-count">{(f.source_count ?? 0) === 1 ? "1 source" : `${f.source_count ?? 0} sources`}</span>
          <ChevronRight size={16} strokeWidth={1.75} className="sec-topic-chev" aria-hidden />
        </button>
        {organizing && <button className="sec-topic-move" onClick={() => { setFormError(""); setMoveFor(f); }} title="Move to another section">
          <ArrowRightLeft size={14} strokeWidth={1.75} aria-hidden /> move
        </button>}
      </div>
    );
  }

  const noTopics = sections !== null && topics.length === 0;

  return (
    <div className="mgmt">
      {returnTo && <button className="lib-back" onClick={() => nav(returnTo)}>← Return to session</button>}
      <div className="mgmt-titlerow">
        <h1 className="mgmt-title">Library</h1>
      </div>
      <p className="int-prose">The sources you choose, organized into topics and sections.</p>
      <div className="library-primary">
        <button className="btn" disabled={sections === null} onClick={() => { setFormError(""); setDestination(topics[0]?.slug ?? "new"); setDestinationOpen(true); }}><Plus size={18} aria-hidden /> Add source</button>
        <button className="btn ghost" onClick={() => nav("/import")}>Import</button>
      </div>
      <button className="intent-link" aria-expanded={organizing} onClick={() => setOrganizing((v) => !v)}>Organize library</button>
      {organizing && <div className="mgmt-actions library-organize">
        <button className="mgmt-edit" onClick={() => { setFormError(""); setAddTopicOpen(true); }}><Plus size={15} aria-hidden /> Add topic</button>
        <button className="mgmt-edit" onClick={() => { setFormError(""); setAddOpen(true); }}><Plus size={15} aria-hidden /> Add section</button>
      </div>}
      {err && <div role="alert"><p className="err">{err}</p><button className="btn ghost" onClick={reload}>Retry</button></div>}
      {notice && <p role="status">{notice}</p>}

      {sections === null && !err ? (
        <p className="lib2-subtitle">Loading…</p>
      ) : sections === null ? null : noTopics ? (
        // #138 first-run: nothing added yet.
        <div className="firstrun">
          <p className="firstrun-lead">Welcome. Otium is empty until you add the feeds you care about.</p>
          <p className="firstrun-step">Add a source above: an RSS/Atom feed, YouTube channel, or podcast. Choose or create its topic along the way.</p>
          <HowItWorks defaultOpen />
        </div>
      ) : (
        sections.map((section) => {
          const list = bySection.get(section.id) ?? [];
          return (
            <div className="section-zone" key={section.id}>
              <div className="section-zone-head">
                <span className="section-zone-name">{section.name}</span>
                {organizing && <button className="mgmt-edit" onClick={() => (setFormError(""), setRenameDraft(section.name), setRenameFor(section))}>
                  <Pencil size={13} strokeWidth={1.9} aria-hidden /> edit
                </button>}
              </div>
              {list.length === 0 ? (
                <p className="section-empty">No topics yet - move one here or add a topic from the library.</p>
              ) : (
                <div className="sec-topics">{list.map(TopicRow)}</div>
              )}
            </div>
          );
        })
      )}

      <Dialog open={destinationOpen} onClose={() => !saving && setDestinationOpen(false)} kicker="Add source · destination">
        {formStatus}
        <label className="flow-label" htmlFor="source-topic">Topic</label>
        <select id="source-topic" className="field" value={destination} onChange={(e) => setDestination(e.target.value)}>
          {topics.map((t) => <option key={t.slug} value={t.slug}>{t.section_name ? `${t.section_name} / ` : ""}{t.name}</option>)}
          <option value="new">Create a topic</option>
        </select>
        {destination === "new" && <>
          <label className="flow-label" htmlFor="source-new-topic">New topic name</label>
          <input id="source-new-topic" className="field" value={destinationName} onChange={(e) => setDestinationName(e.target.value)} placeholder="e.g. Local news" />
          <label className="flow-label" htmlFor="source-section">Section</label>
          <select id="source-section" className="field" value={destinationSection} onChange={(e) => setDestinationSection(e.target.value)}>
            <option value="">Uncategorized</option>
            {(sections ?? []).map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
          </select>
        </>}
        <div className="dlg-actions"><button className="btn" disabled={saving || (destination === "new" && !destinationName.trim())} onClick={chooseDestination}>Continue</button></div>
      </Dialog>
      {sourceTopic && <AddSourceWizard open topic={sourceTopic} ytAvailable={ytAvailable} onClose={() => setSourceTopic(null)} onAdded={() => { setNotice("Source added"); void reload(); }} />}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} kicker="Add section">
        {formStatus}
        <input className="field" aria-label="Section name" placeholder="e.g. News" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        <div className="dlg-actions">
          <button className="btn" onClick={create} disabled={saving || !newName.trim()}>
            Add section
          </button>
        </div>
      </Dialog>

      <Dialog open={addTopicOpen} onClose={() => setAddTopicOpen(false)} kicker="Add topic">
        {formStatus}
        <input className="field" aria-label="Topic name" placeholder="e.g. Local News" value={newTopic} autoFocus onChange={(e) => setNewTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createTopic()} />
        <p className="caphint">Lands in Uncategorized - move it into a section afterward, and add sources from its page.</p>
        <div className="dlg-actions">
          <button className="btn" onClick={createTopic} disabled={saving || !newTopic.trim()}>
            Add topic
          </button>
        </div>
      </Dialog>

      <Dialog open={renameFor !== null} onClose={() => setRenameFor(null)} kicker="Edit section">
        {formStatus}
        <div className="dlg-sub">Name</div>
        <input className="field" aria-label="Section name" value={renameDraft} autoFocus onChange={(e) => setRenameDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveRename()} />
        <div className="dlg-sub">Icon</div>
        <div className="icon-grid">
          <button className={`icon-cell ${!renameFor?.icon ? "on" : ""}`} onClick={() => chooseSectionIcon("")} aria-label="No icon">
            <span className="introw-dot" />
          </button>
          {FEED_ICONS.map((def) => {
            const I = def.Icon;
            return (
              <button
                key={def.key}
                className={`icon-cell ${renameFor?.icon === def.key ? "on" : ""}`}
                onClick={() => chooseSectionIcon(def.key)}
                aria-label={def.label}
                title={def.label}
              >
                {I && <I size={20} strokeWidth={1.6} />}
              </button>
            );
          })}
        </div>
        <div className="dlg-actions">
          <button className="btn danger" onClick={del}>
            Delete
          </button>
          <button className="btn" onClick={saveRename} disabled={saving || !renameDraft.trim()}>
            Save
          </button>
        </div>
      </Dialog>

      <Dialog open={moveFor !== null} onClose={() => setMoveFor(null)} kicker={moveFor ? `Move "${moveFor.name}"` : "Move topic"}>
        {formStatus}
        <div className="dlg-sub">Move to section</div>
        <div className="dlg-opts">
          {(sections ?? []).map((s) => (
            <button
              key={s.id}
              className={`dlg-opt ${moveFor?.section_id === s.id ? "on" : ""}`}
              onClick={() => moveTopic(s.id)}
              disabled={saving || moveFor?.section_id === s.id}
            >
              <span className="dlg-radio" aria-hidden />
              <span className="dlg-name">{s.name}</span>
              {moveFor?.section_id === s.id && <span className="dlg-sub">current</span>}
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
