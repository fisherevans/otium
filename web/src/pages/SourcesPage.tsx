import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Plus } from "lucide-react";
import { api, type Topic, type Section } from "@/api/client";
import { feedIcon } from "@/lib/feedIcons";
import { BottomSheet } from "@/components/BottomSheet";
import { HowItWorks } from "@/components/HowItWorks";

// The Library home (session engine v2). Two stacked sections, per the mockup:
//   - Sections: pill chips that filter the topic list ("All", each section, "No Section"),
//     with a manage link into /sections.
//   - Topics: the primary list. Each topic drills into its sources
//     (Library -> Topic -> Source -> Articles spine).
// A section is a group of topics (many-to-many); "No Section" is the bucket of topics
// in no section. Membership is read from sectionBrowse (a handful of calls).
type SectionFilter = number | "all" | "none";

export default function SourcesPage() {
  const nav = useNavigate();
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [membership, setMembership] = useState<Map<number, Set<number>>>(new Map());
  const [filter, setFilter] = useState<SectionFilter>("all");
  const [err, setErr] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  function reloadTopics() {
    api.topics().then((t) => setTopics(t ?? [])).catch((e) => setErr(String(e.message ?? e)));
  }
  async function reloadSections() {
    try {
      const ms = await api.sections();
      setSections(ms);
      const m = new Map<number, Set<number>>();
      await Promise.all(
        ms.map(async (section) => {
          const b = await api.sectionBrowse(section.id).catch(() => null);
          if (!b) return;
          for (const f of b.topics) {
            if (!m.has(f.id)) m.set(f.id, new Set());
            m.get(f.id)!.add(section.id);
          }
        }),
      );
      setMembership(m);
    } catch {
      /* sections are optional */
    }
  }

  useEffect(() => {
    reloadTopics();
    reloadSections();
  }, []);

  const shown = useMemo(() => {
    if (!topics) return [];
    if (filter === "all") return topics;
    if (filter === "none") return topics.filter((f) => !(membership.get(f.id)?.size));
    return topics.filter((f) => membership.get(f.id)?.has(filter));
  }, [topics, filter, membership]);

  const filteredOut = topics ? topics.length - shown.length : 0;

  async function create() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      await api.createTopic(name);
      setNewName("");
      setAddOpen(false);
      reloadTopics();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="lib2">
      {/* --- Sections --- */}
      <div className="lib2-head">
        <h1 className="lib2-title">Sections</h1>
        <button className="lib2-action" onClick={() => nav("/sections")}>
          <Pencil size={13} strokeWidth={1.9} aria-hidden /> manage
        </button>
      </div>
      <p className="lib2-subtitle">Group your topics</p>
      {err && <p className="err">{err}</p>}

      <div className="sectionchips">
        <button className={`sectionchip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
          All
        </button>
        {sections.map((m) => (
          <button key={m.id} className={`sectionchip ${filter === m.id ? "on" : ""}`} onClick={() => setFilter(m.id)}>
            {m.name}
          </button>
        ))}
        <button className={`sectionchip muted ${filter === "none" ? "on" : ""}`} onClick={() => setFilter("none")}>
          No Section
        </button>
      </div>

      {/* --- Topics --- */}
      <div className="lib2-head topics">
        <h2 className="lib2-title">Topics</h2>
        <button className="lib2-action" onClick={() => setAddOpen(true)}>
          <Plus size={15} strokeWidth={1.9} aria-hidden /> Add topic
        </button>
      </div>

      {topics === null ? (
        <p className="lib2-subtitle">Loading…</p>
      ) : topics.length === 0 ? (
        // #138 first-run: no topics at all. Welcome + the model + a clear first step.
        <div className="firstrun">
          <p className="firstrun-lead">Welcome. Otium is empty until you add the feeds you care about.</p>
          <p className="firstrun-step">
            Start by adding a <b>topic</b> (say "News" or "Comedy") with <b>Add topic</b> above - then open it to add
            <b> sources</b>: any RSS/Atom feed, a YouTube channel, a podcast. Group topics into <b>sections</b> later if you like.
          </p>
          <button className="btn" onClick={() => setAddOpen(true)}>
            Add your first topic
          </button>
          <HowItWorks defaultOpen />
        </div>
      ) : shown.length === 0 ? (
        <p className="lib2-empty">No topics in this section.</p>
      ) : (
        <>
          {shown.map((f) => {
            const Ic = feedIcon(f.icon);
            const n = f.source_count ?? 0;
            return (
              <button className="introw" key={f.id} onClick={() => nav(`/topics/${f.slug}`)}>
                <span className="introw-glyph" aria-hidden>
                  {Ic ? <Ic size={22} strokeWidth={1.6} /> : <span className="introw-dot" />}
                </span>
                <span className="introw-body">
                  <span className="introw-name">{f.name}</span>
                  <span className="introw-count">
                    {n} {n === 1 ? "source" : "sources"}
                    {(f.articles_per_month ?? 0) > 0 && <> · ~{f.articles_per_month}/mo</>}
                  </span>
                </span>
              </button>
            );
          })}
          {filter !== "all" && filteredOut > 0 && (
            <p className="lib2-filtered">
              {filteredOut} {filteredOut === 1 ? "topic" : "topics"} filtered out
            </p>
          )}
        </>
      )}

      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} kicker="New topic">
        <div className="sheet-title">Name the topic</div>
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
            {creating ? "Adding…" : "Add topic"}
          </button>
        </div>
        <p className="caphint">An topic groups sources. Add sources to it from its page.</p>
      </BottomSheet>
    </div>
  );
}
