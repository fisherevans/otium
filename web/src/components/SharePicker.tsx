import { headline } from "@/lib/posts";
import { CheckCircle2, Circle, Hash, User, ChevronRight, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Item, type ShareResult, type ShareTarget } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import "./sharing.css";

// Send on Discord (#195): pick friends and channels by nickname, add an optional
// note, send. Each target succeeds or fails on its own and the sheet says which.
// Friends get a DM from the Otium bot; channels get a post. Sending fires a
// `share` event only - it is never a ranking signal.
export function SharePicker({ item, open, onClose }: { item: Item | null; open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [targets, setTargets] = useState<ShareTarget[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<ShareResult[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setNote("");
    setResults(null);
    setErr("");
    setLoading(true);
    api
      .shareTargets()
      .then(setTargets)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [open, item?.id]);

  function toggle(t: ShareTarget) {
    if (t.status === "pending") return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(t.id)) next.delete(t.id);
      else next.add(t.id);
      return next;
    });
  }

  async function send() {
    if (!item || picked.size === 0) return;
    setSending(true);
    setErr("");
    try {
      const r = await api.shareItem(item.id, [...picked], note.trim());
      setResults(r.results);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setSending(false);
    }
  }

  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <BottomSheet open={open} onClose={onClose} kicker="Send on Discord">
      <div className="sheet-title share-title">{item && headline(item, 140)}</div>
      {err && <p className="err" role="alert">{err}</p>}

      {results ? (
        <div className="share-results" role="status">
          {results.map((r) => (
            <div key={r.target_id} className={`share-result ${r.ok ? "ok" : "bad"}`}>
              {r.ok ? <CheckCircle2 size={18} aria-hidden /> : <AlertCircle size={18} aria-hidden />}
              <span>
                <b>{r.nickname}</b> {r.ok ? "· sent" : <span className="share-why">{r.error}</span>}
              </span>
            </div>
          ))}
          <div className="share-actions">
            {failed.length > 0 && (
              <button className="btn ghost" onClick={() => { setPicked(new Set(failed.map((f) => f.target_id))); setResults(null); }}>
                Try the failed ones again
              </button>
            )}
            <button className="btn" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : loading ? (
        <p className="sub" role="status">Loading friends and channels…</p>
      ) : targets.length === 0 ? (
        <div className="share-empty">
          <p className="sub">No friends or channels yet. Add a friend by nickname and send them a connect link, or pick a Discord channel.</p>
          <button className="btn" onClick={() => { onClose(); nav("/settings/sharing"); }}>Set up sharing</button>
        </div>
      ) : (
        <>
          <div className="sheet-rows">
            {targets.map((t) => (
              <button
                key={t.id}
                className="sheet-row"
                aria-pressed={picked.has(t.id)}
                onClick={() => toggle(t)}
                disabled={sending || t.status === "pending"}
              >
                <span className="save-check" aria-hidden>
                  {picked.has(t.id) ? <CheckCircle2 size={20} className="inline-icon" /> : <Circle size={20} className="inline-icon" />}
                </span>
                <span className="share-target">
                  <span className="share-nick">{t.nickname}</span>
                  <span className="share-sub">
                    {t.kind === "channel"
                      ? <><Hash size={13} aria-hidden /> {t.channel_name} · {t.guild_name}</>
                      : t.status === "pending"
                        ? "Hasn't connected yet"
                        : <><User size={13} aria-hidden /> {t.discord_name}</>}
                    {t.status === "failing" && <span className="share-warn"> · last send failed</span>}
                  </span>
                </span>
              </button>
            ))}
            <button className="sheet-row" onClick={() => { onClose(); nav("/settings/sharing"); }}>
              <span className="sheet-row-label">Manage friends and channels</span>
              <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
            </button>
          </div>
          <label className="share-note">
            <span className="sub">Note (optional)</span>
            <textarea className="field" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Why you're sending it" />
          </label>
          <div className="share-actions">
            <button className="btn" onClick={send} disabled={picked.size === 0 || sending}>
              {sending ? "Sending…" : picked.size <= 1 ? "Send" : `Send to ${picked.size}`}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
