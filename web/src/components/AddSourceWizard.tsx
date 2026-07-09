import { useState } from "react";
import { api, type Interest, type ScoringConfig } from "@/api/client";
import { type Bucket } from "@/lib/represent";
import { Dialog } from "@/components/Dialog";
import { ArchiveChoice } from "@/components/ArchiveChoice";
import { RepresentationPicker } from "@/components/RepresentationPicker";

// AddSourceWizard (#127): a three-step add-source flow.
//   1. pick the source type
//   2. identify it - an RSS/podcast URL, or a YouTube channel search where the user
//      picks the right result (with an "open channel" link to verify)
//   3. name + per-source options (import full history for YouTube, representation,
//      archive rule, article order/length, keywords), then create.
// The source is created with the chosen identifier, attached to the interest, then
// patched with any non-default options in one follow-up call.
type Kind = "rss" | "youtube" | "podcast";
type YtResult = { channel_id: string; title: string; thumbnail: string; description: string; feed_url: string; channel_url: string };

export function AddSourceWizard({
  open,
  interest,
  ytAvailable,
  onClose,
  onAdded,
}: {
  open: boolean;
  interest: Interest;
  ytAvailable: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<Kind>("rss");
  const [err, setErr] = useState("");

  // step 2
  const [url, setUrl] = useState("");
  const [ytQuery, setYtQuery] = useState("");
  const [ytResults, setYtResults] = useState<YtResult[] | null>(null);
  const [ytSearching, setYtSearching] = useState(false);
  const [ytSelected, setYtSelected] = useState<YtResult | null>(null);

  // step 3
  const [name, setName] = useState("");
  const [importAll, setImportAll] = useState(true);
  const [bucket, setBucket] = useState<Bucket>("normal");
  const [archiveDays, setArchiveDays] = useState(0);
  const [keepCount, setKeepCount] = useState(0);
  const [combine, setCombine] = useState<"and" | "or">("and");
  const [direction, setDirection] = useState<"newest" | "oldest" | "random">("newest");
  const [lengthPrefer, setLengthPrefer] = useState<"longer" | "shorter" | null>(null);
  const [keywords, setKeywords] = useState("");
  const [adding, setAdding] = useState(false);

  function reset() {
    setStep(1);
    setKind("rss");
    setErr("");
    setUrl("");
    setYtQuery("");
    setYtResults(null);
    setYtSelected(null);
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
    reset();
    onClose();
  }

  function pickKind(k: Kind) {
    setKind(k);
    setErr("");
    setStep(2);
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
      const created = await api.createSource({
        kind,
        title: name.trim() || (isYt && ytSelected ? ytSelected.title : url),
        ...(isYt && ytSelected
          ? { channel_id: ytSelected.channel_id, icon_url: ytSelected.thumbnail, import_backlog: importAll }
          : { feed_url: url.trim() }),
      });
      await api.setSourceInterest(created.id, interest.slug).catch(() => {});
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
      if (Object.keys(patch).length) await api.updateSource(created.id, patch).catch(() => {});
      onAdded();
      close();
    } catch (e: any) {
      setErr(String(e.message ?? e).replace(/^Error:\s*/, ""));
    } finally {
      setAdding(false);
    }
  }

  const kicker = step === 1 ? "Add source" : step === 2 ? "Add source · identify" : "Add source · options";

  return (
    <Dialog open={open} onClose={close} kicker={kicker}>
      {err && <p className="err">{err}</p>}

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
                <span className="dlg-sub">channel via Data API - full history + durations</span>
              </button>
            )}
            <button className="dlg-opt" onClick={() => pickKind("podcast")}>
              <span className="dlg-radio" aria-hidden />
              <span className="dlg-name">Podcast</span>
              <span className="dlg-sub">audio feed URL</span>
            </button>
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
              onBlur={ytSearch}
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
                  onClick={() => setYtSelected(r)}
                >
                  <span className="yt-result-radio" aria-hidden />
                  {r.thumbnail ? <img className="yt-result-av" src={r.thumbnail} alt="" /> : <span className="yt-result-av ph" />}
                  <div className="yt-result-body">
                    <div className="yt-result-title">{r.title}</div>
                    {r.description && <div className="yt-result-desc">{r.description}</div>}
                  </div>
                  <a className="yt-result-open" href={r.channel_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    Open ↗
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

      {step === 2 && kind !== "youtube" && (
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
                {importAll ? "✓" : ""}
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
            intDays={interest.archive_after_days ?? 0}
            interestName={interest.name}
            onChange={setArchiveDays}
            keepCount={keepCount}
            combine={combine}
            onKeepCount={setKeepCount}
            onCombine={setCombine}
          />

          <div className="dlg-sub">Article order</div>
          <div className="dlg-opts">
            {(["newest", "oldest", "random"] as const).map((d) => (
              <button key={d} className={`dlg-opt ${direction === d ? "on" : ""}`} onClick={() => setDirection(d)}>
                <span className="dlg-radio" aria-hidden />
                <span className="dlg-name">{d === "newest" ? "Newest first" : d === "oldest" ? "Oldest first" : "Random"}</span>
                <span className="dlg-sub">
                  {d === "newest" ? "reverse chronological" : d === "oldest" ? "work through the backlog" : "shuffled by age"}
                </span>
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
