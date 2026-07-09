import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Plus, ChevronRight, ArrowRightLeft } from "lucide-react";
import { api, type Topic, type Section } from "@/api/client";
import { feedIcon, FEED_ICONS } from "@/lib/feedIcons";
import { Dialog } from "@/components/Dialog";
import { HowItWorks } from "@/components/HowItWorks";

// The Library landing (#131, strict Section>Topic>Source tree). Sections group
// topics one-to-many; each section lists its topics. Tap a topic to manage it, or
// use "move" to reassign it. No drag - an explicit Move dialog reads calmer and
// works on touch. Add a section/topic + rename/delete/icon happen in dialogs. This
// replaced the old flat /sources library page.
export default function SectionsPage() {
  const nav = useNavigate();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [err, setErr] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [addTopicOpen, setAddTopicOpen] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [renameFor, setRenameFor] = useState<Section | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [moveFor, setMoveFor] = useState<Topic | null>(null);

  function reload() {
    api.sections().then(setSections).catch((e: any) => setErr(String(e.message ?? e)));
    api.topics().then((t) => setTopics(t ?? [])).catch(() => {});
  }
  useEffect(reload, []);

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
    const name = newName.trim();
    if (!name) return;
    setAddOpen(false);
    setNewName("");
    await api.createSection(name).catch((e: any) => setErr(String(e.message ?? e)));
    reload();
  }
  async function createTopic() {
    const name = newTopic.trim();
    if (!name) return;
    setAddTopicOpen(false);
    setNewTopic("");
    // No section chosen -> lands in Uncategorized; move it after with the Move link.
    await api.createTopic(name).catch((e: any) => setErr(String(e.message ?? e)));
    reload();
  }
  async function chooseSectionIcon(key: string) {
    if (!renameFor) return;
    const next = renameFor.icon === key ? "" : key;
    await api.updateSection(renameFor.id, { icon: next }).catch(() => {});
    setRenameFor((m) => (m ? { ...m, icon: next } : m));
    reload();
  }
  async function saveRename() {
    if (!renameFor) return;
    const name = renameDraft.trim();
    const m = renameFor;
    setRenameFor(null);
    if (name && name !== m.name) {
      await api.updateSection(m.id, { name }).catch(() => {});
      reload();
    }
  }
  async function del() {
    if (!renameFor) return;
    const m = renameFor;
    setRenameFor(null);
    // The server reassigns this section's topics to Uncategorized before deleting.
    await api.deleteSection(m.id).catch(() => {});
    reload();
  }
  async function moveTopic(sectionId: number) {
    if (!moveFor) return;
    const t = moveFor;
    setMoveFor(null);
    await api.moveTopicToSection(t.id, sectionId).catch(() => {});
    reload();
  }

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
        <button className="sec-topic-move" onClick={() => setMoveFor(f)} title="Move to another section">
          <ArrowRightLeft size={14} strokeWidth={1.75} aria-hidden /> move
        </button>
      </div>
    );
  }

  const noTopics = sections !== null && topics.length === 0;

  return (
    <div className="mgmt">
      <div className="mgmt-titlerow">
        <h1 className="mgmt-title">Library</h1>
        <div className="mgmt-actions">
          <button className="mgmt-edit" onClick={() => (setNewTopic(""), setAddTopicOpen(true))}>
            <Plus size={15} strokeWidth={1.9} aria-hidden /> Topic
          </button>
          <button className="mgmt-edit" onClick={() => (setNewName(""), setAddOpen(true))}>
            <Plus size={15} strokeWidth={1.9} aria-hidden /> Section
          </button>
        </div>
      </div>
      <p className="int-prose">Your sources, grouped as sections of topics. Tap a topic to manage its sources, or move it to another section.</p>
      {err && <p className="err">{err}</p>}

      {sections === null ? (
        <p className="lib2-subtitle">Loading…</p>
      ) : noTopics ? (
        // #138 first-run: nothing added yet.
        <div className="firstrun">
          <p className="firstrun-lead">Welcome. Otium is empty until you add the feeds you care about.</p>
          <p className="firstrun-step">
            Start by adding a <b>topic</b> (say "News" or "Comedy") - then open it to add <b>sources</b>: any RSS/Atom feed, a
            YouTube channel, a podcast. Group topics into <b>sections</b> whenever you like.
          </p>
          <button className="btn" onClick={() => (setNewTopic(""), setAddTopicOpen(true))}>
            Add your first topic
          </button>
          <HowItWorks defaultOpen />
        </div>
      ) : (
        sections.map((section) => {
          const list = bySection.get(section.id) ?? [];
          return (
            <div className="section-zone" key={section.id}>
              <div className="section-zone-head">
                <span className="section-zone-name">{section.name}</span>
                <button className="mgmt-edit" onClick={() => (setRenameDraft(section.name), setRenameFor(section))}>
                  <Pencil size={13} strokeWidth={1.9} aria-hidden /> edit
                </button>
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

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} kicker="Add section">
        <input className="field" placeholder="e.g. News" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        <div className="dlg-actions">
          <button className="btn" onClick={create} disabled={!newName.trim()}>
            Add section
          </button>
        </div>
      </Dialog>

      <Dialog open={addTopicOpen} onClose={() => setAddTopicOpen(false)} kicker="Add topic">
        <input className="field" placeholder="e.g. Local News" value={newTopic} autoFocus onChange={(e) => setNewTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createTopic()} />
        <p className="caphint">Lands in Uncategorized - move it into a section afterward, and add sources from its page.</p>
        <div className="dlg-actions">
          <button className="btn" onClick={createTopic} disabled={!newTopic.trim()}>
            Add topic
          </button>
        </div>
      </Dialog>

      <Dialog open={renameFor !== null} onClose={() => setRenameFor(null)} kicker="Edit section">
        <div className="dlg-sub">Name</div>
        <input className="field" value={renameDraft} autoFocus onChange={(e) => setRenameDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveRename()} />
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
          <button className="btn" onClick={saveRename} disabled={!renameDraft.trim()}>
            Save
          </button>
        </div>
      </Dialog>

      <Dialog open={moveFor !== null} onClose={() => setMoveFor(null)} kicker={moveFor ? `Move "${moveFor.name}"` : "Move topic"}>
        <div className="dlg-sub">Move to section</div>
        <div className="dlg-opts">
          {(sections ?? []).map((s) => (
            <button
              key={s.id}
              className={`dlg-opt ${moveFor?.section_id === s.id ? "on" : ""}`}
              onClick={() => moveTopic(s.id)}
              disabled={moveFor?.section_id === s.id}
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
