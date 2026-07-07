import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil } from "lucide-react";
import { api, type Interest, type Mix } from "@/api/client";
import { feedIcon } from "@/lib/feedIcons";
import { BottomSheet } from "@/components/BottomSheet";

// Manage Mixes (session engine v2). A mix groups interests (many-to-many). This page
// is where you organize that grouping: add a mix, rename it, and move interests
// between mixes. Each mix lists its member interests; tapping an interest opens a
// membership sheet to add/remove it across mixes (that's how you "move" one). An
// "Other interests" section collects interests that belong to no mix.
export default function MixesPage() {
  const nav = useNavigate();
  const [mixes, setMixes] = useState<Mix[] | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  // mixId -> set of interest ids in it (seeded from browse, updated optimistically).
  const [members, setMembers] = useState<Map<number, Set<number>>>(new Map());
  const [err, setErr] = useState("");

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [moveFor, setMoveFor] = useState<Interest | null>(null);
  const [renameFor, setRenameFor] = useState<Mix | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

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

  async function create() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      await api.createMix(name);
      setNewName("");
      await reload();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setCreating(false);
    }
  }

  async function toggleMembership(mix: Mix, interestId: number) {
    const set = new Set(members.get(mix.id) ?? []);
    set.has(interestId) ? set.delete(interestId) : set.add(interestId);
    const next = new Map(members);
    next.set(mix.id, set);
    setMembers(next); // optimistic
    await api.setMixInterests(mix.id, [...set]).catch(() => {});
    // refresh interest_count on the mix cards
    api.mixes().then(setMixes).catch(() => {});
  }

  async function saveRename() {
    if (!renameFor) return;
    const name = renameDraft.trim();
    if (name && name !== renameFor.name) {
      await api.updateMix(renameFor.id, { name }).catch(() => {});
    }
    setRenameFor(null);
    reload();
  }
  async function del() {
    if (!renameFor) return;
    await api.deleteMix(renameFor.id).catch(() => {});
    setConfirmDel(false);
    setRenameFor(null);
    reload();
  }

  return (
    <div>
      <button className="lib-back" onClick={() => nav("/sources")}>
        <span aria-hidden>←</span> Library
      </button>
      <div className="lib-topbar">
        <h1 className="display">Mixes</h1>
      </div>
      <p className="sub">
        A mix groups interests - "News" might hold Local and International. An interest can live in several mixes. Tap an
        interest to move it.
      </p>
      {err && <p className="err">{err}</p>}

      <div className="lib-add" style={{ marginBottom: 8 }}>
        <input
          className="field"
          placeholder="New mix name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button className="btn" onClick={create} disabled={creating || !newName.trim()}>
          {creating ? "Adding…" : "Add mix"}
        </button>
      </div>

      {mixes === null ? (
        <p className="sub">Loading…</p>
      ) : mixes.length === 0 ? (
        <p className="sub" style={{ padding: "8px 0" }}>No mixes yet. Create one above.</p>
      ) : (
        mixes.map((mix) => {
          const Ic = feedIcon(mix.icon);
          const mem = memberInterests(mix);
          return (
            <div className="page-section" key={mix.id} style={{ marginTop: 20 }}>
              <div className="mix-head">
                {Ic && <Ic size={15} strokeWidth={1.75} aria-hidden />}
                <span className="mix-head-nm">{mix.name}</span>
                <span className="mix-head-cnt">{mem.length}</span>
                <button
                  className="int-edit"
                  onClick={() => {
                    setRenameFor(mix);
                    setRenameDraft(mix.name);
                    setConfirmDel(false);
                  }}
                  aria-label={`Rename ${mix.name}`}
                >
                  <Pencil size={12} strokeWidth={1.75} aria-hidden /> Edit
                </button>
              </div>
              {mem.length === 0 ? (
                <p className="caphint" style={{ padding: "4px 0" }}>No interests yet - tap one below to add it.</p>
              ) : (
                mem.map((f) => {
                  const FIc = feedIcon(f.icon);
                  return (
                    <button className="mix-int-row" key={f.id} onClick={() => setMoveFor(f)}>
                      <span className="int-glyph" aria-hidden>
                        {FIc ? <FIc size={16} strokeWidth={1.75} /> : <span className="int-dot" />}
                      </span>
                      <span className="mix-int-nm">{f.name}</span>
                      <span className="mix-int-move">Move</span>
                    </button>
                  );
                })
              )}
            </div>
          );
        })
      )}

      {/* Interests in no mix. */}
      <div className="page-section" style={{ marginTop: 24 }}>
        <div className="ctl-label">Other interests</div>
        {noMix.length === 0 ? (
          <p className="caphint" style={{ padding: "4px 0" }}>Every interest is in a mix.</p>
        ) : (
          noMix.map((f) => {
            const FIc = feedIcon(f.icon);
            return (
              <button className="mix-int-row" key={f.id} onClick={() => setMoveFor(f)}>
                <span className="int-glyph" aria-hidden>
                  {FIc ? <FIc size={16} strokeWidth={1.75} /> : <span className="int-dot" />}
                </span>
                <span className="mix-int-nm">{f.name}</span>
                <span className="mix-int-move">Add to mix</span>
              </button>
            );
          })
        )}
      </div>

      {/* Membership sheet: toggle this interest across mixes. */}
      <BottomSheet open={moveFor !== null} onClose={() => setMoveFor(null)} kicker="Move interest">
        {moveFor && (
          <>
            <div className="sheet-title">Which mixes hold {moveFor.name}?</div>
            <div className="sheet-rows">
              {(mixes ?? []).map((mix) => {
                const on = members.get(mix.id)?.has(moveFor.id) ?? false;
                return (
                  <button key={mix.id} className="sheet-row" onClick={() => toggleMembership(mix, moveFor)}>
                    <span>{mix.name}</span>
                    <span className={`pick-check ${on ? "on" : ""}`} aria-hidden />
                  </button>
                );
              })}
            </div>
            <p className="caphint" style={{ marginTop: 12 }}>
              Toggle the mixes this interest belongs to. Uncheck all to leave it in no mix.
            </p>
          </>
        )}
      </BottomSheet>

      {/* Rename / delete a mix. */}
      <BottomSheet open={renameFor !== null} onClose={() => setRenameFor(null)} kicker="Edit mix">
        {renameFor && (
          <>
            <div className="sheet-title">Rename {renameFor.name}</div>
            <div className="lib-add">
              <input
                className="field"
                value={renameDraft}
                autoFocus
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveRename()}
              />
              <button className="btn" onClick={saveRename} disabled={!renameDraft.trim()}>Save</button>
            </div>
            {confirmDel ? (
              <div className="confirm">
                Delete {renameFor.name}? The interests stay; only the grouping goes.
                <div className="lib-actions">
                  <button onClick={() => setConfirmDel(false)}>Cancel</button>
                  <button onClick={del}>Delete</button>
                </div>
              </div>
            ) : (
              <div className="lib-actions">
                <button onClick={() => setConfirmDel(true)}>Delete mix</button>
              </div>
            )}
          </>
        )}
      </BottomSheet>
    </div>
  );
}
