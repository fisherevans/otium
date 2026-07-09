import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Plus, ChevronRight, ArrowRightLeft } from "lucide-react";
import { api, type Topic, type Section } from "@/api/client";
import { feedIcon, FEED_ICONS } from "@/lib/feedIcons";
import { Dialog } from "@/components/Dialog";

// Manage Sections (#131, strict Section>Topic>Source tree). A section groups topics
// one-to-many. Each section lists its topics; tap a topic to manage it, or use
// "move" to reassign it to another section. No drag - an explicit Move dialog reads
// calmer and works on touch. Add a section + rename/delete/icon happen in dialogs.
export default function SectionsPage() {
  const nav = useNavigate();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [err, setErr] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameFor, setRenameFor] = useState<Section | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [moveFor, setMoveFor] = useState<Topic | null>(null);

  function reload() {
    api.sections().then(setSections).catch((e: any) => setErr(String(e.message ?? e)));
    api.topics().then(setTopics).catch(() => {});
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

  return (
    <div className="mgmt">
      <button className="mgmt-back" onClick={() => nav("/sources")}>
        ← Library
      </button>
      <div className="mgmt-titlerow">
        <h1 className="mgmt-title">Sections</h1>
        <button className="mgmt-edit" onClick={() => (setNewName(""), setAddOpen(true))}>
          <Plus size={15} strokeWidth={1.9} aria-hidden /> Add section
        </button>
      </div>
      <p className="int-prose">Sections group your topics. A topic belongs to one section - tap it to manage it, or move it to another section.</p>
      {err && <p className="err">{err}</p>}

      {sections === null ? (
        <p className="lib2-subtitle">Loading…</p>
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
