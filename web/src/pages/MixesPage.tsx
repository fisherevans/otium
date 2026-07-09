import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Plus, GripVertical } from "lucide-react";
import { api, type Interest, type Mix } from "@/api/client";
import { feedIcon, FEED_ICONS } from "@/lib/feedIcons";
import { Dialog } from "@/components/Dialog";

// Manage Mixes (session engine v2, mockup #2). A mix groups interests
// (many-to-many). Each mix is a drop zone listing its member interests as
// draggable cards; drag an interest from one mix to another to move it, or to
// "Other interests" to drop it out. Add a mix + rename/delete happen in dialogs.
// (HTML5 drag - desktop; a touch fallback is a follow-up.)
type Zone = number | "other" | null;

export default function MixesPage() {
  const nav = useNavigate();
  const [mixes, setMixes] = useState<Mix[] | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [members, setMembers] = useState<Map<number, Set<number>>>(new Map());
  const [err, setErr] = useState("");

  const [drag, setDrag] = useState<{ interestId: number; fromMix: number | null } | null>(null);
  const [over, setOver] = useState<Zone>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameFor, setRenameFor] = useState<Mix | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  async function reload() {
    try {
      const ms = await api.mixes();
      setMixes(ms);
      const m = new Map<number, Set<number>>();
      await Promise.all(
        ms.map(async (mix) => {
          const b = await api.mixBrowse(mix.id).catch(() => null);
          m.set(mix.id, new Set(b ? b.interests.map((f) => f.id) : []));
        }),
      );
      setMembers(m);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  useEffect(() => {
    reload();
    api.interests().then(setInterests).catch(() => {});
  }, []);

  const noMix = useMemo(() => {
    const inSome = new Set<number>();
    members.forEach((set) => set.forEach((id) => inSome.add(id)));
    return interests.filter((f) => !inSome.has(f.id));
  }, [interests, members]);

  function memberInterests(mix: Mix): Interest[] {
    const set = members.get(mix.id);
    if (!set) return [];
    return interests.filter((f) => set.has(f.id));
  }

  async function drop(zone: Zone) {
    setOver(null);
    const d = drag;
    setDrag(null);
    if (!d || zone === null) return;
    const toMix = zone === "other" ? null : zone;
    if (d.fromMix === toMix) return;

    const next = new Map([...members].map(([k, v]) => [k, new Set(v)] as const));
    if (d.fromMix !== null) next.get(d.fromMix)?.delete(d.interestId);
    if (toMix !== null) {
      if (!next.has(toMix)) next.set(toMix, new Set());
      next.get(toMix)!.add(d.interestId);
    }
    setMembers(next); // optimistic

    const affected = new Set<number>();
    if (d.fromMix !== null) affected.add(d.fromMix);
    if (toMix !== null) affected.add(toMix);
    for (const mid of affected) {
      await api.setMixInterests(mid, [...(next.get(mid) ?? [])]).catch(() => {});
    }
    api.mixes().then(setMixes).catch(() => {});
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setAddOpen(false);
    setNewName("");
    await api.createMix(name).catch((e: any) => setErr(String(e.message ?? e)));
    reload();
  }
  async function chooseMixIcon(key: string) {
    if (!renameFor) return;
    const next = renameFor.icon === key ? "" : key;
    await api.updateMix(renameFor.id, { icon: next }).catch(() => {});
    setRenameFor((m) => (m ? { ...m, icon: next } : m));
    reload();
  }
  async function saveRename() {
    if (!renameFor) return;
    const name = renameDraft.trim();
    const m = renameFor;
    setRenameFor(null);
    if (name && name !== m.name) {
      await api.updateMix(m.id, { name }).catch(() => {});
      reload();
    }
  }
  async function del() {
    if (!renameFor) return;
    const m = renameFor;
    setRenameFor(null);
    await api.deleteMix(m.id).catch(() => {});
    reload();
  }

  function Card(f: Interest, fromMix: number | null) {
    const I = feedIcon(f.icon);
    return (
      <div
        className={`mix-card ${drag?.interestId === f.id ? "dragging" : ""}`}
        key={`${fromMix}-${f.id}`}
        draggable
        onDragStart={() => setDrag({ interestId: f.id, fromMix })}
        onDragEnd={() => (setDrag(null), setOver(null))}
      >
        <span className="mix-card-glyph" aria-hidden>
          {I ? <I size={18} strokeWidth={1.6} /> : <span className="introw-dot" />}
        </span>
        <span className="mix-card-name">{f.name}</span>
        <span className="mix-card-grip" aria-hidden>
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
        <h1 className="mgmt-title">Mixes</h1>
        <button className="mgmt-edit" onClick={() => (setNewName(""), setAddOpen(true))}>
          <Plus size={15} strokeWidth={1.9} aria-hidden /> Add mix
        </button>
      </div>
      <p className="int-prose">Drag an interest between mixes to move it. An interest can live in several mixes.</p>
      {err && <p className="err">{err}</p>}

      {mixes === null ? (
        <p className="lib2-subtitle">Loading…</p>
      ) : (
        <>
          {mixes.map((mix) => (
            <div
              className={`mix-zone ${over === mix.id ? "over" : ""}`}
              key={mix.id}
              onDragOver={(e) => (e.preventDefault(), setOver(mix.id))}
              onDragLeave={() => setOver((o) => (o === mix.id ? null : o))}
              onDrop={() => drop(mix.id)}
            >
              <div className="mix-zone-head">
                <span className="mix-zone-name">{mix.name}</span>
                <button className="mgmt-edit" onClick={() => (setRenameDraft(mix.name), setRenameFor(mix))}>
                  <Pencil size={13} strokeWidth={1.9} aria-hidden /> rename
                </button>
              </div>
              {memberInterests(mix).length === 0 ? (
                <p className="mix-empty">No interests yet - drag one here.</p>
              ) : (
                <div className="mix-cards">{memberInterests(mix).map((f) => Card(f, mix.id))}</div>
              )}
            </div>
          ))}

          <div
            className={`mix-zone ${over === "other" ? "over" : ""}`}
            onDragOver={(e) => (e.preventDefault(), setOver("other"))}
            onDragLeave={() => setOver((o) => (o === "other" ? null : o))}
            onDrop={() => drop("other")}
          >
            <div className="mix-zone-head">
              <span className="mgmt-seclabel">Other interests</span>
            </div>
            {noMix.length === 0 ? (
              <p className="mix-empty">Every interest is in a mix.</p>
            ) : (
              <div className="mix-cards">{noMix.map((f) => Card(f, null))}</div>
            )}
          </div>
        </>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} kicker="Add mix">
        <input className="field" placeholder="e.g. News" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        <div className="dlg-actions">
          <button className="btn" onClick={create} disabled={!newName.trim()}>
            Add mix
          </button>
        </div>
      </Dialog>

      <Dialog open={renameFor !== null} onClose={() => setRenameFor(null)} kicker="Rename mix">
        <div className="dlg-sub">Name</div>
        <input className="field" value={renameDraft} autoFocus onChange={(e) => setRenameDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveRename()} />
        <div className="dlg-sub">Icon</div>
        <div className="icon-grid">
          <button className={`icon-cell ${!renameFor?.icon ? "on" : ""}`} onClick={() => chooseMixIcon("")} aria-label="No icon">
            <span className="introw-dot" />
          </button>
          {FEED_ICONS.map((def) => {
            const I = def.Icon;
            return (
              <button
                key={def.key}
                className={`icon-cell ${renameFor?.icon === def.key ? "on" : ""}`}
                onClick={() => chooseMixIcon(def.key)}
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
