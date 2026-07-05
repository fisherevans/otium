import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Feed, type Group } from "@/api/client";
import { feedIcon } from "@/lib/feedIcons";

// Groups management (#86). A group is a user-created overlay that gathers several
// FEEDS under one name ("News" = Local + International); a feed can be in many
// groups. This page is the whole surface: create / rename / delete a group,
// toggle which feeds belong to it, and browse Group -> Feed (each member feed
// links to its page, which lists its sources - completing Group -> Feed -> Source).
//
// It lives on its own route (reached from the Library's Manage sheet) rather than
// in the library header, so the v0.21 four-tab nav stays uncluttered.
export default function GroupsPage() {
  const nav = useNavigate();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [err, setErr] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // The expanded group + its current feed-id membership (seeded from the browse
  // endpoint so the chips reflect the server, then updated optimistically).
  const [openId, setOpenId] = useState<number | null>(null);
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  const [renaming, setRenaming] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  function reload() {
    api.groups().then(setGroups).catch((e) => setErr(String(e.message ?? e)));
  }
  useEffect(() => {
    reload();
    api.feeds().then(setFeeds).catch(() => {});
  }, []);

  async function openGroup(g: Group) {
    if (openId === g.id) {
      setOpenId(null);
      return;
    }
    setOpenId(g.id);
    setRenaming(g.name);
    setConfirmDel(false);
    setMemberIds(new Set());
    try {
      const b = await api.groupBrowse(g.id);
      setMemberIds(new Set(b.feeds.map((f) => f.id)));
    } catch {
      /* leave empty on error */
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      await api.createGroup(name);
      setNewName("");
      reload();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setCreating(false);
    }
  }

  async function toggleFeed(g: Group, feedId: number) {
    const next = new Set(memberIds);
    next.has(feedId) ? next.delete(feedId) : next.add(feedId);
    setMemberIds(next); // optimistic
    await api.setGroupFeeds(g.id, [...next]).catch(() => {});
    reload(); // refresh feed_count
  }

  async function saveName(g: Group) {
    const name = renaming.trim();
    if (!name || name === g.name) return;
    await api.updateGroup(g.id, { name }).catch(() => {});
    reload();
  }

  async function del(g: Group) {
    await api.deleteGroup(g.id).catch(() => {});
    setOpenId(null);
    reload();
  }

  return (
    <div>
      <button className="lib-back" onClick={() => nav("/sources")}>
        <span aria-hidden>←</span> Library
      </button>
      <div className="lib-topbar">
        <h1 className="display">Groups</h1>
      </div>
      <p className="sub">
        Gather feeds under one name - "News" might hold Local and International. A feed can live in several groups.
      </p>
      {err && <p className="err">{err}</p>}

      {/* Create */}
      <div className="lib-add" style={{ marginBottom: 16 }}>
        <input
          className="field"
          placeholder="New group name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button className="btn" onClick={create} disabled={creating || !newName.trim()}>
          {creating ? "Adding…" : "Add group"}
        </button>
      </div>

      {groups === null ? (
        <p className="sub">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="sub" style={{ padding: "8px 0" }}>No groups yet. Create one above.</p>
      ) : (
        groups.map((g) => {
          const Ic = feedIcon(g.icon);
          const open = openId === g.id;
          const memberFeeds = feeds.filter((f) => memberIds.has(f.id));
          return (
            <div className="lib-row" key={g.id}>
              <div className="lib-head" onClick={() => openGroup(g)}>
                {Ic && <Ic size={16} strokeWidth={1.75} aria-hidden />}
                <div className="nm">
                  <b>{g.name}</b>
                  <span>{g.feed_count} {g.feed_count === 1 ? "feed" : "feeds"}</span>
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

                  {/* Feed membership */}
                  <div className="ctl-label">Feeds in this group</div>
                  {feeds.length === 0 ? (
                    <p className="caphint">No feeds yet.</p>
                  ) : (
                    <div className="feed-assign">
                      {feeds.map((f) => {
                        const FIc = feedIcon(f.icon);
                        return (
                          <button
                            key={f.id}
                            className={`fa-chip ${memberIds.has(f.id) ? "on" : ""}`}
                            onClick={() => toggleFeed(g, f.id)}
                          >
                            {FIc && <FIc size={13} strokeWidth={1.75} aria-hidden />}
                            {f.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="caphint">Tap a feed to add or remove it from this group.</p>

                  {/* Browse into member feeds (Group -> Feed -> Source) */}
                  {memberFeeds.length > 0 && (
                    <>
                      <div className="ctl-label">Browse</div>
                      {memberFeeds.map((f) => {
                        const FIc = feedIcon(f.icon);
                        return (
                          <button
                            key={f.id}
                            className="lib-group as-link"
                            onClick={() => nav(`/feeds/${f.slug}`)}
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
                      Delete {g.name}? The feeds stay; only the grouping goes.
                      <div className="lib-actions">
                        <button onClick={() => setConfirmDel(false)}>Cancel</button>
                        <button onClick={() => del(g)}>Delete</button>
                      </div>
                    </div>
                  ) : (
                    <div className="lib-actions">
                      <button onClick={() => setConfirmDel(true)}>Delete group</button>
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
