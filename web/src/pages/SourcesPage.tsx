import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Interest, type Mix } from "@/api/client";
import { feedIcon } from "@/lib/feedIcons";
import { BottomSheet } from "@/components/BottomSheet";

// The Library home (session engine v2). Interest-centric: the top row filters the
// interest list by mix, the list drills into each interest, and each interest drills
// into its sources. This is the Library → Interest → Source → Articles spine; the
// old flat source list moved under the interest pages.
//
// A "mix" is a group of interests (many-to-many). The chips filter which interests
// show; "No mix" is the bucket of interests that belong to no mix. Mix membership is
// read from mixBrowse (one call per mix - there are only a handful), which also
// backs the "part of {mix}" line on the interest page.
type MixFilter = number | "all" | "none";

export default function SourcesPage() {
  const nav = useNavigate();
  const [interests, setInterests] = useState<Interest[] | null>(null);
  const [mixes, setMixes] = useState<Mix[]>([]);
  // interestId -> set of mix ids it belongs to.
  const [membership, setMembership] = useState<Map<number, Set<number>>>(new Map());
  const [filter, setFilter] = useState<MixFilter>("all");
  const [err, setErr] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  function reloadInterests() {
    api.interests().then(setInterests).catch((e) => setErr(String(e.message ?? e)));
  }
  async function reloadMixes() {
    try {
      const ms = await api.mixes();
      setMixes(ms);
      // Build interest -> mixes membership from each mix's browse payload.
      const m = new Map<number, Set<number>>();
      await Promise.all(
        ms.map(async (mix) => {
          const b = await api.mixBrowse(mix.id).catch(() => null);
          if (!b) return;
          for (const f of b.interests) {
            if (!m.has(f.id)) m.set(f.id, new Set());
            m.get(f.id)!.add(mix.id);
          }
        }),
      );
      setMembership(m);
    } catch {
      /* mixes are optional; leave empty */
    }
  }

  useEffect(() => {
    reloadInterests();
    reloadMixes();
  }, []);

  const shown = useMemo(() => {
    if (!interests) return [];
    if (filter === "all") return interests;
    if (filter === "none") return interests.filter((f) => !(membership.get(f.id)?.size));
    return interests.filter((f) => membership.get(f.id)?.has(filter));
  }, [interests, filter, membership]);

  async function create() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      await api.createInterest(name);
      setNewName("");
      setAddOpen(false);
      reloadInterests();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <button className="lib-back" onClick={() => nav("/")}>
        <span aria-hidden>←</span> Start a session
      </button>

      <div className="lib-topbar">
        <h1 className="display">Library</h1>
        <div className="lib-topbar-actions">
          <button className="lib-fsbtn" onClick={() => nav("/mixes")}>
            Manage mixes
          </button>
        </div>
      </div>
      <p className="sub">Your interests, grouped by mix. Open one to see its sources and how they behave.</p>
      {err && <p className="err">{err}</p>}

      {/* Mix filter chips: All, each mix, then the "no mix" bucket. */}
      <div className="lib-filter">
        <button className={`lib-fchip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
          All interests
        </button>
        {mixes.map((m) => {
          const Ic = feedIcon(m.icon);
          return (
            <button key={m.id} className={`lib-fchip ${filter === m.id ? "on" : ""}`} onClick={() => setFilter(m.id)}>
              {Ic && <Ic size={13} strokeWidth={1.75} aria-hidden />}
              {m.name}
            </button>
          );
        })}
        <button className={`lib-fchip ${filter === "none" ? "on" : ""}`} onClick={() => setFilter("none")}>
          No mix
        </button>
      </div>

      {/* Interests list. Count from the interest's own source_count. */}
      {interests === null ? (
        <p className="sub">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="sub" style={{ padding: "12px 0" }}>
          {filter === "all" ? "No interests yet. Add one below." : "No interests in this mix."}
        </p>
      ) : (
        shown.map((f) => {
          const Ic = feedIcon(f.icon);
          const n = f.source_count ?? 0;
          return (
            <div className="lib-row" key={f.id}>
              <div className="lib-head" onClick={() => nav(`/interests/${f.slug}`)}>
                <span className="int-glyph" aria-hidden>
                  {Ic ? <Ic size={18} strokeWidth={1.75} /> : <span className="int-dot" />}
                </span>
                <div className="nm">
                  <b>{f.name}</b>
                  <span>{n} {n === 1 ? "source" : "sources"}</span>
                </div>
                <span className="chev">▸</span>
              </div>
            </div>
          );
        })
      )}

      <button className="lib-addrow" onClick={() => setAddOpen(true)}>
        <span className="int-glyph" aria-hidden>+</span>
        <span>Add interest</span>
      </button>

      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} kicker="New interest">
        <div className="sheet-title">Name the interest</div>
        <div className="lib-add">
          <input
            className="field"
            placeholder="e.g. Dev Blogs"
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <button className="btn" onClick={create} disabled={creating || !newName.trim()}>
            {creating ? "Adding…" : "Add interest"}
          </button>
        </div>
        <p className="caphint">An interest groups sources. Add sources to it from its page.</p>
      </BottomSheet>
    </div>
  );
}
