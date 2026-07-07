import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Interest, type Mix } from "@/api/client";
import { feedIcon } from "@/lib/feedIcons";

// Mixes management (#86). A mix is a user-created overlay that gathers several
// FEEDS under one name ("News" = Local + International); a interest can be in many
// mixes. This page is the whole surface: create / rename / delete a mix,
// toggle which interests belong to it, and browse Mix -> Interest (each member interest
// links to its page, which lists its sources - completing Mix -> Interest -> Source).
//
// It lives on its own route (reached from the Library's Manage sheet) rather than
// in the library header, so the v0.21 four-tab nav stays uncluttered.
export default function MixesPage() {
  const nav = useNavigate();
  const [mixes, setMixes] = useState<Mix[] | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [err, setErr] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // The expanded mix + its current interest-id membership (seeded from the browse
  // endpoint so the chips reflect the server, then updated optimistically).
  const [openId, setOpenId] = useState<number | null>(null);
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  const [renaming, setRenaming] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  function reload() {
    api.mixes().then(setMixes).catch((e) => setErr(String(e.message ?? e)));
  }
  useEffect(() => {
    reload();
    api.interests().then(setInterests).catch(() => {});
  }, []);

  async function openMix(g: Mix) {
    if (openId === g.id) {
      setOpenId(null);
      return;
    }
    setOpenId(g.id);
    setRenaming(g.name);
    setConfirmDel(false);
    setMemberIds(new Set());
    try {
      const b = await api.mixBrowse(g.id);
      setMemberIds(new Set(b.interests.map((f) => f.id)));
    } catch {
      /* leave empty on error */
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      await api.createMix(name);
      setNewName("");
      reload();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setCreating(false);
    }
  }

  async function toggleInterest(g: Mix, interestId: number) {
    const next = new Set(memberIds);
    next.has(interestId) ? next.delete(interestId) : next.add(interestId);
    setMemberIds(next); // optimistic
    await api.setMixInterests(g.id, [...next]).catch(() => {});
    reload(); // refresh interest_count
  }

  async function saveName(g: Mix) {
    const name = renaming.trim();
    if (!name || name === g.name) return;
    await api.updateMix(g.id, { name }).catch(() => {});
    reload();
  }

  async function del(g: Mix) {
    await api.deleteMix(g.id).catch(() => {});
    setOpenId(null);
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
        Gather interests under one name - "News" might hold Local and International. A interest can live in several mixes.
      </p>
      {err && <p className="err">{err}</p>}

      {/* Create */}
      <div className="lib-add" style={{ marginBottom: 16 }}>
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
        mixes.map((g) => {
          const Ic = feedIcon(g.icon);
          const open = openId === g.id;
          const memberInterests = interests.filter((f) => memberIds.has(f.id));
          return (
            <div className="lib-row" key={g.id}>
              <div className="lib-head" onClick={() => openMix(g)}>
                {Ic && <Ic size={16} strokeWidth={1.75} aria-hidden />}
                <div className="nm">
                  <b>{g.name}</b>
                  <span>{g.interest_count} {g.interest_count === 1 ? "interest" : "interests"}</span>
                </div>
                <span className="chev">{open ? "▾" : "▸"}</span>
              </div>

              {open && (
                <div className="page-section" style={{ marginTop: 4 }}>
                  {/* Rename */}
                  <div className="ctl-label">Name</div>
                  <div className="lib-add">
                    <input
                      className="field"
                      value={renaming}
                      onChange={(e) => setRenaming(e.target.value)}
                      onBlur={() => saveName(g)}
                      onKeyDown={(e) => e.key === "Enter" && saveName(g)}
                    />
                  </div>

                  {/* Interest membership */}
                  <div className="ctl-label">Interests in this mix</div>
                  {interests.length === 0 ? (
                    <p className="caphint">No interests yet.</p>
                  ) : (
                    <div className="interest-assign">
                      {interests.map((f) => {
                        const FIc = feedIcon(f.icon);
                        return (
                          <button
                            key={f.id}
                            className={`fa-chip ${memberIds.has(f.id) ? "on" : ""}`}
                            onClick={() => toggleInterest(g, f.id)}
                          >
                            {FIc && <FIc size={13} strokeWidth={1.75} aria-hidden />}
                            {f.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="caphint">Tap a interest to add or remove it from this mix.</p>

                  {/* Browse into member interests (Mix -> Interest -> Source) */}
                  {memberInterests.length > 0 && (
                    <>
                      <div className="ctl-label">Browse</div>
                      {memberInterests.map((f) => {
                        const FIc = feedIcon(f.icon);
                        return (
                          <button
                            key={f.id}
                            className="lib-mix as-link"
                            onClick={() => nav(`/interests/${f.slug}`)}
                          >
                            {FIc && <FIc size={14} strokeWidth={1.75} aria-hidden />}
                            <span>{f.name}</span>
                            <span className="cnt">{f.source_count ?? 0}</span>
                            <span className="chev" aria-hidden>▸</span>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {/* Delete */}
                  {confirmDel ? (
                    <div className="confirm">
                      Delete {g.name}? The interests stay; only the grouping goes.
                      <div className="lib-actions">
                        <button onClick={() => setConfirmDel(false)}>Cancel</button>
                        <button onClick={() => del(g)}>Delete</button>
                      </div>
                    </div>
                  ) : (
                    <div className="lib-actions">
                      <button onClick={() => setConfirmDel(true)}>Delete mix</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
