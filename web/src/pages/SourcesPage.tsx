import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Plus } from "lucide-react";
import { api, type Interest, type Mix } from "@/api/client";
import { feedIcon } from "@/lib/feedIcons";
import { BottomSheet } from "@/components/BottomSheet";

// The Library home (session engine v2). Two stacked sections, per the mockup:
//   - Mixes: pill chips that filter the interest list ("All", each mix, "No Mix"),
//     with a manage link into /mixes.
//   - Interests: the primary list. Each interest drills into its sources
//     (Library -> Interest -> Source -> Articles spine).
// A mix is a group of interests (many-to-many); "No Mix" is the bucket of interests
// in no mix. Membership is read from mixBrowse (a handful of calls).
type MixFilter = number | "all" | "none";

export default function SourcesPage() {
  const nav = useNavigate();
  const [interests, setInterests] = useState<Interest[] | null>(null);
  const [mixes, setMixes] = useState<Mix[]>([]);
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
      /* mixes are optional */
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

  const filteredOut = interests ? interests.length - shown.length : 0;

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
    <div className="lib2">
      {/* --- Mixes --- */}
      <div className="lib2-head">
        <h1 className="lib2-title">Mixes</h1>
        <button className="lib2-action" onClick={() => nav("/mixes")}>
          <Pencil size={13} strokeWidth={1.9} aria-hidden /> manage
        </button>
      </div>
      <p className="lib2-subtitle">Group your interests</p>
      {err && <p className="err">{err}</p>}

      <div className="mixchips">
        <button className={`mixchip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
          All
        </button>
        {mixes.map((m) => (
          <button key={m.id} className={`mixchip ${filter === m.id ? "on" : ""}`} onClick={() => setFilter(m.id)}>
            {m.name}
          </button>
        ))}
        <button className={`mixchip muted ${filter === "none" ? "on" : ""}`} onClick={() => setFilter("none")}>
          No Mix
        </button>
      </div>

      {/* --- Interests --- */}
      <div className="lib2-head interests">
        <h2 className="lib2-title">Interests</h2>
        <button className="lib2-action" onClick={() => setAddOpen(true)}>
          <Plus size={15} strokeWidth={1.9} aria-hidden /> Add interest
        </button>
      </div>

      {interests === null ? (
        <p className="lib2-subtitle">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="lib2-empty">{filter === "all" ? "No interests yet - add one above." : "No interests in this mix."}</p>
      ) : (
        <>
          {shown.map((f) => {
            const Ic = feedIcon(f.icon);
            const n = f.source_count ?? 0;
            return (
              <button className="introw" key={f.id} onClick={() => nav(`/interests/${f.slug}`)}>
                <span className="introw-glyph" aria-hidden>
                  {Ic ? <Ic size={22} strokeWidth={1.6} /> : <span className="introw-dot" />}
                </span>
                <span className="introw-body">
                  <span className="introw-name">{f.name}</span>
                  <span className="introw-count">
                    {n} {n === 1 ? "source" : "sources"}
                  </span>
                </span>
              </button>
            );
          })}
          {filter !== "all" && filteredOut > 0 && (
            <p className="lib2-filtered">
              {filteredOut} {filteredOut === 1 ? "interest" : "interests"} filtered out
            </p>
          )}
        </>
      )}

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
