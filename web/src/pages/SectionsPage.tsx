import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Plus, GripVertical } from "lucide-react";
import { api, type Topic, type Section } from "@/api/client";
import { feedIcon, FEED_ICONS } from "@/lib/feedIcons";
import { Dialog } from "@/components/Dialog";

// Manage Sections (session engine v2, mockup #2). A section groups topics
// (many-to-many). Each section is a drop zone listing its member topics as
// draggable cards; drag an topic from one section to another to move it, or to
// "Other topics" to drop it out. Add a section + rename/delete happen in dialogs.
// (HTML5 drag - desktop; a touch fallback is a follow-up.)
type Zone = number | "other" | null;

export default function SectionsPage() {
  const nav = useNavigate();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [members, setMembers] = useState<Map<number, Set<number>>>(new Map());
  const [err, setErr] = useState("");

  const [drag, setDrag] = useState<{ topicId: number; fromSection: number | null } | null>(null);
  const [over, setOver] = useState<Zone>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameFor, setRenameFor] = useState<Section | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  async function reload() {
    try {
      const ms = await api.sections();
      setSections(ms);
      const m = new Map<number, Set<number>>();
      await Promise.all(
        ms.map(async (section) => {
          const b = await api.sectionBrowse(section.id).catch(() => null);
          m.set(section.id, new Set(b ? b.topics.map((f) => f.id) : []));
        }),
      );
      setMembers(m);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  useEffect(() => {
    reload();
    api.topics().then(setTopics).catch(() => {});
  }, []);

  const noSection = useMemo(() => {
    const inSome = new Set<number>();
    members.forEach((set) => set.forEach((id) => inSome.add(id)));
    return topics.filter((f) => !inSome.has(f.id));
  }, [topics, members]);

  function memberTopics(section: Section): Topic[] {
    const set = members.get(section.id);
    if (!set) return [];
    return topics.filter((f) => set.has(f.id));
  }

  async function drop(zone: Zone) {
    setOver(null);
    const d = drag;
    setDrag(null);
    if (!d || zone === null) return;
    const toSection = zone === "other" ? null : zone;
    if (d.fromSection === toSection) return;

    const next = new Map([...members].map(([k, v]) => [k, new Set(v)] as const));
    if (d.fromSection !== null) next.get(d.fromSection)?.delete(d.topicId);
    if (toSection !== null) {
      if (!next.has(toSection)) next.set(toSection, new Set());
      next.get(toSection)!.add(d.topicId);
    }
    setMembers(next); // optimistic

    const affected = new Set<number>();
    if (d.fromSection !== null) affected.add(d.fromSection);
    if (toSection !== null) affected.add(toSection);
    for (const mid of affected) {
      await api.setSectionTopics(mid, [...(next.get(mid) ?? [])]).catch(() => {});
    }
    api.sections().then(setSections).catch(() => {});
  }

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
    await api.deleteSection(m.id).catch(() => {});
    reload();
  }

  function Card(f: Topic, fromSection: number | null) {
    const I = feedIcon(f.icon);
    return (
      <div
        className={`section-card ${drag?.topicId === f.id ? "dragging" : ""}`}
        key={`${fromSection}-${f.id}`}
        draggable
        onDragStart={() => setDrag({ topicId: f.id, fromSection })}
        onDragEnd={() => (setDrag(null), setOver(null))}
      >
        <span className="section-card-glyph" aria-hidden>
          {I ? <I size={18} strokeWidth={1.6} /> : <span className="introw-dot" />}
        </span>
        <span className="section-card-name">{f.name}</span>
        <span className="section-card-grip" aria-hidden>
          <GripVertical size={16} strokeWidth={1.75} />
        </span>
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
      <p className="int-prose">Drag an topic between sections to move it. An topic can live in several sections.</p>
      {err && <p className="err">{err}</p>}

      {sections === null ? (
        <p className="lib2-subtitle">Loading…</p>
      ) : (
        <>
          {sections.map((section) => (
            <div
              className={`section-zone ${over === section.id ? "over" : ""}`}
              key={section.id}
              onDragOver={(e) => (e.preventDefault(), setOver(section.id))}
              onDragLeave={() => setOver((o) => (o === section.id ? null : o))}
              onDrop={() => drop(section.id)}
            >
              <div className="section-zone-head">
                <span className="section-zone-name">{section.name}</span>
                <button className="mgmt-edit" onClick={() => (setRenameDraft(section.name), setRenameFor(section))}>
                  <Pencil size={13} strokeWidth={1.9} aria-hidden /> rename
                </button>
              </div>
              {memberTopics(section).length === 0 ? (
                <p className="section-empty">No topics yet - drag one here.</p>
              ) : (
                <div className="section-cards">{memberTopics(section).map((f) => Card(f, section.id))}</div>
              )}
            </div>
          ))}

          <div
            className={`section-zone ${over === "other" ? "over" : ""}`}
            onDragOver={(e) => (e.preventDefault(), setOver("other"))}
            onDragLeave={() => setOver((o) => (o === "other" ? null : o))}
            onDrop={() => drop("other")}
          >
            <div className="section-zone-head">
              <span className="mgmt-seclabel">Other topics</span>
            </div>
            {noSection.length === 0 ? (
              <p className="section-empty">Every topic is in a section.</p>
            ) : (
              <div className="section-cards">{noSection.map((f) => Card(f, null))}</div>
            )}
          </div>
        </>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} kicker="Add section">
        <input className="field" placeholder="e.g. News" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        <div className="dlg-actions">
          <button className="btn" onClick={create} disabled={!newName.trim()}>
            Add section
          </button>
        </div>
      </Dialog>

      <Dialog open={renameFor !== null} onClose={() => setRenameFor(null)} kicker="Rename section">
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
    </div>
  );
}
