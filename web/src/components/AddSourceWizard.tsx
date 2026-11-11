import { ExternalLink, Check } from "lucide-react";
import { useRef, useState } from "react";
import { api, type Topic, type ScoringConfig } from "@/api/client";
import { type Bucket } from "@/lib/represent";
import { Dialog } from "@/components/Dialog";
import { ArchiveChoice } from "@/components/ArchiveChoice";
import { RepresentationPicker } from "@/components/RepresentationPicker";
import { ordersFor, type Direction } from "@/lib/articleOrder";

// AddSourceWizard (#127): a three-step add-source flow.
//   1. pick the source type
//   2. identify it - an RSS/podcast URL, or a YouTube channel search where the user
//      picks the right result (with an "open channel" link to verify)
//   3. name + per-source options (import full history for YouTube, representation,
//      archive rule, article order/length, keywords), then create.
// The source is created with the chosen identifier, attached to the topic, then
// patched with any non-default options in one follow-up call.
type Kind = "rss" | "youtube" | "podcast" | "bluesky" | "substack" | "medium" | "tumblr";
type Social = "bluesky" | "substack" | "medium" | "tumblr";
type Resolved = { kind: string; feed_url: string; title: string; icon_url: string; home_url: string };

// #197: the social kinds resolve what a person pastes (a handle, a profile link)
// to a feed on the server, so step 2 is a lookup with a preview, not a feed URL.
const SOCIAL: Record<Social, { name: string; sub: string; label: string; placeholder: string }> = {
  bluesky: { name: "Bluesky", sub: "posts from an account", label: "Handle or profile link", placeholder: "name.bsky.social" },
  substack: { name: "Substack", sub: "a newsletter", label: "Publication name or link", placeholder: "name.substack.com" },
  medium: { name: "Medium", sub: "a writer or publication", label: "Profile or publication link", placeholder: "medium.com/@name" },
  tumblr: { name: "Tumblr", sub: "a blog", label: "Blog name or link", placeholder: "name.tumblr.com" },
};
const isSocial = (k: Kind): k is Social => k in SOCIAL;
type YtResult = { channel_id: string; title: string; thumbnail: string; description: string; feed_url: string; channel_url: string };

export function AddSourceWizard({
  open,
  topic,
  ytAvailable,
  onClose,
  onAdded,
}: {
  open: boolean;
  topic: Topic;
  ytAvailable: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const createdId = useRef<number | null>(null);
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<Kind>("rss");
  const [err, setErr] = useState("");

  // step 2
  const [url, setUrl] = useState("");
  const [ytQuery, setYtQuery] = useState("");
  const [ytResults, setYtResults] = useState<YtResult[] | null>(null);
  const [ytSearching, setYtSearching] = useState(false);
  const [ytSelected, setYtSelected] = useState<YtResult | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [resolving, setResolving] = useState(false);

  // step 3
  const [name, setName] = useState("");
  const [importAll, setImportAll] = useState(true);
  const [bucket, setBucket] = useState<Bucket>("normal");
  const [archiveDays, setArchiveDays] = useState(0);
  const [keepCount, setKeepCount] = useState(0);
  const [combine, setCombine] = useState<"and" | "or">("and");
  const [direction, setDirection] = useState<Direction>("newest");
  const [lengthPrefer, setLengthPrefer] = useState<"longer" | "shorter" | null>(null);
  const [keywords, setKeywords] = useState("");
  const [adding, setAdding] = useState(false);

  function reset() {
    createdId.current = null;
    setStep(1);
    setKind("rss");
    setErr("");
    setUrl("");
    setYtQuery("");
    setYtResults(null);
    setYtSelected(null);
    setResolved(null);
    setName("");
    setImportAll(true);
    setBucket("normal");
    setArchiveDays(0);
    setKeepCount(0);
    setCombine("and");
    setDirection("newest");
    setLengthPrefer(null);
    setKeywords("");
  }
  function close() {
    if (adding) return;
    reset();
    onClose();
  }

  function pickKind(k: Kind) {
    setKind(k);
    setErr("");
    setResolved(null);
    setUrl("");
    // A Bluesky account posts many small things a day: start it on the busy-source
    // defaults (#197) - the best of the last three days, not the latest few.
    if (k === "bluesky") {
      setDirection("popular");
      setArchiveDays(3);
    } else {
      setDirection("newest");
      setArchiveDays(0);
    }
    setStep(2);
  }

  async function resolveSocial() {
    const q = url.trim();
    if (!q || resolving) return;
    setResolving(true);
    setErr("");
    setResolved(null);
    try {
      setResolved(await api.resolveSocial(kind, q));
    } catch (e: any) {
      setErr(String(e.message ?? e).replace(/^Error:\s*/, ""));
    } finally {
      setResolving(false);
    }
  }

  async function ytSearch() {
    const q = ytQuery.trim();
    if (!q || ytSearching) return;
    setYtSearching(true);
    setErr("");
    setYtSelected(null);
    try {
      setYtResults(await api.searchYouTube(q));
    } catch (e: any) {
      setErr(String(e.message ?? e).replace(/^Error:\s*/, ""));
      setYtResults([]);
    } finally {
      setYtSearching(false);
    }
  }

  function toStep3() {
    if (kind === "youtube") {
      if (!ytSelected) return;
      setName(ytSelected.title);
    } else if (isSocial(kind)) {
      if (!resolved) return;
      setName(resolved.title);
    } else {
      if (!url.trim()) return;
    }
    setErr("");
    setStep(3);
  }

  async function add() {
    if (adding) return;
    setAdding(true);
    setErr("");
    try {
      const isYt = kind === "youtube";
      if (createdId.current === null) {
        const created = await api.createSource({
          kind,
          title: name.trim() || (isYt && ytSelected ? ytSelected.title : resolved?.title || url),
          ...(isYt && ytSelected
            ? { channel_id: ytSelected.channel_id, icon_url: ytSelected.thumbnail, import_backlog: importAll }
            : isSocial(kind) && resolved
              ? { feed_url: resolved.feed_url, icon_url: resolved.icon_url }
              : { feed_url: url.trim() }),
        });
        createdId.current = created.id;
      }
      await api.setSourceTopic(createdId.current, topic.slug);
      // Patch only the options that differ from the defaults.
      const patch: Parameters<typeof api.updateSource>[1] = {};
      if (bucket !== "normal") patch.weight_bucket = bucket;
      if (archiveDays !== 0) patch.archive_after_days = archiveDays;
      if (keepCount > 0) {
        patch.archive_keep_count = keepCount;
        patch.archive_combine = combine;
      }
      if (direction !== "newest" || lengthPrefer) {
        const sc: ScoringConfig = {};
        if (direction !== "newest") sc.direction = direction;
        if (lengthPrefer) sc.length = { prefer: lengthPrefer };
        patch.scoring_config = sc;
      }
      if (keywords.trim()) patch.archive_keywords = keywords.trim();
      if (Object.keys(patch).length) await api.updateSource(createdId.current, patch);
      onAdded();
      reset();
      onClose();
    } catch (e: any) {
      setErr((createdId.current !== null ? "Source created, but setup did not finish. Retry to finish without adding it again. " : "") + String(e.message ?? e).replace(/^Error:\s*/, ""));
    } finally {
      setAdding(false);
    }
  }

  const kicker = step === 1 ? "Add source" : step === 2 ? "Add source · identify" : "Add source · options";

  return (
    <Dialog open={open} onClose={close} kicker={kicker}>
      {err && <p role="alert" className="err">{err}</p>}

      {step === 1 && (
        <>
          <div className="dlg-sub">Type</div>
          <div className="dlg-opts">
            <button className="dlg-opt" onClick={() => pickKind("rss")}>
              <span className="dlg-radio" aria-hidden />
              <span className="dlg-name">RSS / Atom</span>
              <span className="dlg-sub">any feed URL</span>
            </button>
            {ytAvailable && (
              <button className="dlg-opt" onClick={() => pickKind("youtube")}>
                <span className="dlg-radio" aria-hidden />
                <span className="dlg-name">YouTube</span>
                <span className="dlg-sub">videos from a channel</span>
              </button>
            )}
            <button className="dlg-opt" onClick={() => pickKind("podcast")}>
              <span className="dlg-radio" aria-hidden />
              <span className="dlg-name">Podcast</span>
              <span className="dlg-sub">audio feed URL</span>
            </button>
            {(Object.keys(SOCIAL) as Social[]).map((k) => (
              <button key={k} className="dlg-opt" onClick={() => pickKind(k)}>
                <span className="dlg-radio" aria-hidden />
                <span className="dlg-name">{SOCIAL[k].name}</span>
                <span className="dlg-sub">{SOCIAL[k].sub}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 2 && kind === "youtube" && (
        <>
          <div className="dlg-sub">Search for a channel</div>
          <div className="yt-resolve-row">
            <input
              className="field"
              placeholder="Channel name, @handle, or URL"
              value={ytQuery}
              autoFocus
              onChange={(e) => setYtQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ytSearch()}
            />
            <button className="btn ghost" onClick={ytSearch} disabled={ytSearching || !ytQuery.trim()}>
              {ytSearching ? "…" : "Search"}
            </button>
          </div>
          {ytResults && ytResults.length === 0 && !ytSearching && <p className="caphint">No channels found. Try a different name.</p>}
          {ytResults && ytResults.length > 0 && (
            <div className="yt-results">
              {ytResults.map((r) => (
                <div
                  key={r.channel_id}
                  className={`yt-result ${ytSelected?.channel_id === r.channel_id ? "sel" : ""}`}
                >
                  <button type="button" className="yt-result-select" aria-pressed={ytSelected?.channel_id === r.channel_id} onClick={() => setYtSelected(r)}>
                  <span className="yt-result-radio" aria-hidden />
                  {r.thumbnail ? <img className="yt-result-av" src={r.thumbnail} alt="" /> : <span className="yt-result-av ph" />}
                  <div className="yt-result-body">
                    <div className="yt-result-title">{r.title}</div>
                    {r.description && <div className="yt-result-desc">{r.description}</div>}
                  </div>
                  </button>
                  <a className="yt-result-open" href={r.channel_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    Open <ExternalLink size={14} className="inline-icon" aria-hidden />
                  </a>
                </div>
              ))}
            </div>
          )}
          <div className="dlg-actions wiz-actions">
            <button className="btn ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn" onClick={toStep3} disabled={!ytSelected}>
              Next
            </button>
          </div>
        </>
      )}

      {step === 2 && isSocial(kind) && (
        <>
          <div className="dlg-sub">{SOCIAL[kind].label}</div>
          <div className="yt-resolve-row">
            <input
              className="field"
              placeholder={SOCIAL[kind].placeholder}
              value={url}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => { setUrl(e.target.value); setResolved(null); }}
              onKeyDown={(e) => e.key === "Enter" && resolveSocial()}
            />
            <button className="btn ghost" onClick={resolveSocial} disabled={resolving || !url.trim()}>
              {resolving ? "…" : "Find"}
            </button>
          </div>
          {resolved && (
            <div className="yt-results">
              <div className="yt-result sel">
                <div className="yt-result-select">
                  {resolved.icon_url ? <img className="yt-result-av" src={resolved.icon_url} alt="" /> : <span className="yt-result-av ph" />}
                  <div className="yt-result-body">
                    <div className="yt-result-title">{resolved.title}</div>
                  </div>
                </div>
                <a className="yt-result-open" href={resolved.home_url} target="_blank" rel="noreferrer">
                  Open <ExternalLink size={14} className="inline-icon" aria-hidden />
                </a>
              </div>
            </div>
          )}
          <div className="dlg-actions wiz-actions">
            <button className="btn ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn" onClick={toStep3} disabled={!resolved}>
              Next
            </button>
          </div>
        </>
      )}

      {step === 2 && kind !== "youtube" && !isSocial(kind) && (
        <>
          <div className="dlg-sub">Feed URL</div>
          <input
            className="field"
            placeholder="https://example.com/feed"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && toStep3()}
          />
          <div className="dlg-actions wiz-actions">
            <button className="btn ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn" onClick={toStep3} disabled={!url.trim()}>
              Next
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="dlg-sub">Name</div>
          <input className="field" placeholder="Source name" value={name} onChange={(e) => setName(e.target.value)} />

          {kind === "youtube" && (
            <button className={`dlg-opt ${importAll ? "on" : ""}`} onClick={() => setImportAll((v) => !v)}>
              <span className="dlg-check" aria-hidden>
                {importAll && <Check size={16} className="inline-icon" aria-hidden />}
              </span>
              <span className="dlg-name">Import full history</span>
              <span className="dlg-sub">back to this source's archive window</span>
            </button>
          )}

          <div className="dlg-sub">Representation</div>
          <RepresentationPicker value={bucket} onChange={setBucket} />

          <div className="dlg-sub">Archive after</div>
          <ArchiveChoice
            scope="source"
            value={archiveDays}
            intDays={topic.archive_after_days ?? 0}
            topicName={topic.name}
            onChange={setArchiveDays}
            keepCount={keepCount}
            combine={combine}
            onKeepCount={setKeepCount}
            onCombine={setCombine}
          />

          <div className="dlg-sub">Article order</div>
          <div className="dlg-opts">
            {ordersFor(kind).map((o) => (
              <button key={o.value} className={`dlg-opt ${direction === o.value ? "on" : ""}`} onClick={() => setDirection(o.value)}>
                <span className="dlg-radio" aria-hidden />
                <span className="dlg-name">{o.name}</span>
                <span className="dlg-sub">{o.sub}</span>
              </button>
            ))}
          </div>

          <div className="dlg-sub">Prefer by length</div>
          <div className="dlg-opts">
            {([null, "longer", "shorter"] as const).map((p) => (
              <button key={p ?? "off"} className={`dlg-opt ${lengthPrefer === p ? "on" : ""}`} onClick={() => setLengthPrefer(p)}>
                <span className="dlg-radio" aria-hidden />
                <span className="dlg-name">{p === null ? "No length preference" : p === "longer" ? "Prefer longer" : "Prefer shorter"}</span>
              </button>
            ))}
          </div>

          <div className="dlg-sub">Auto-archive keywords</div>
          <input className="field" placeholder="comma, separated, keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          <p className="caphint">An article whose title contains any of these is archived on arrival.</p>

          <div className="dlg-actions wiz-actions">
            <button className="btn ghost" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn" onClick={add} disabled={adding}>
              {adding ? "Adding…" : "Add source"}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
