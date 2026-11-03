import { ArrowLeft, Hash, User, Copy, Share2, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useBack } from "@/lib/navigation";
import { api, type DiscordGuild, type SentShare, type ShareStatus, type ShareTarget } from "@/api/client";
import { shareStatus } from "@/lib/sharing";
import { canWebShare, copyText, shareOrCopy } from "@/lib/share";
import "@/components/sharing.css";

// Sharing settings (#195): the friends and Discord channels items can be sent to,
// each under a nickname only you see. A friend is added by nickname and connects
// through a one-time link you send them; a channel is picked from the servers the
// Otium bot has been added to.
export default function SharingPage() {
  const back = useBack("/settings");
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [targets, setTargets] = useState<ShareTarget[] | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  function reload() {
    api.shareTargets().then(setTargets).catch((e) => setErr(String(e.message ?? e)));
  }
  useEffect(() => {
    shareStatus().then(setStatus);
    reload();
  }, []);

  function replace(t: ShareTarget) {
    setTargets((prev) => (prev ?? []).map((x) => (x.id === t.id ? t : x)));
  }

  const friends = targets?.filter((t) => t.kind === "friend") ?? [];
  const channels = targets?.filter((t) => t.kind === "channel") ?? [];

  return (
    <div className="sharing-page">
      <button className="lib-back" onClick={back}>
        <ArrowLeft size={18} className="inline-icon" aria-hidden /> Back
      </button>
      <div className="lib-topbar">
        <h1 className="display">Sharing</h1>
      </div>
      <p className="sharing-intro">Send videos and articles to friends and channels on Discord. Nicknames are only shown to you.</p>

      {status && !status.available && <p className="err" role="alert">Discord sharing isn't set up on this server.</p>}
      {err && <p className="err" role="alert">{err}</p>}
      {!targets && !err && <p role="status">Loading…</p>}

      {targets && status?.available && (
        <>
          <h2>Friends</h2>
          {friends.map((t) => (
            <TargetRow key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)}
              onChange={replace} onRemoved={() => { setOpen(null); reload(); }} />
          ))}
          <AddFriend onAdded={(t) => { setTargets((prev) => [...(prev ?? []), t]); setOpen(t.id); }} />

          <h2>Channels</h2>
          {channels.map((t) => (
            <TargetRow key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)}
              onChange={replace} onRemoved={() => { setOpen(null); reload(); }} />
          ))}
          <AddChannel inviteURL={status.invite_url ?? ""} existing={channels}
            onAdded={(t) => setTargets((prev) => [...(prev ?? []), t])} />

          {status.history_url && (
            <p className="sub" style={{ marginTop: 28 }}>
              Friends can see everything you've sent them at {status.history_url.replace(/^https?:\/\//, "")}, after signing in with Discord.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function statusLine(t: ShareTarget): React.ReactNode {
  if (t.kind === "channel") return <><Hash size={13} aria-hidden /> {t.channel_name} · {t.guild_name}</>;
  if (t.status === "pending") return "Waiting for them to connect";
  return <><User size={13} aria-hidden /> {t.discord_name}</>;
}

function TargetRow({ t, open, onToggle, onChange, onRemoved }: {
  t: ShareTarget;
  open: boolean;
  onToggle: () => void;
  onChange: (t: ShareTarget) => void;
  onRemoved: () => void;
}) {
  const [name, setName] = useState(t.nickname);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState<SentShare[] | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(t.nickname);
    setErr("");
    setConfirmRemove(false);
    api.sentShares(t.id).then(setSent).catch(() => setSent([]));
  }, [open, t.id]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try { await fn(); } catch (e: any) { setErr(String(e.message ?? e)); } finally { setBusy(false); }
  }

  return (
    <div className="sharing-row">
      <button className="sharing-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="share-target">
          <span className="share-nick">{t.nickname}</span>
          <span className="share-sub">
            {statusLine(t)}
            {t.share_count > 0 && <> · {t.share_count} sent</>}
            {t.status === "failing" && <span className="share-warn"> · last send failed</span>}
          </span>
        </span>
      </button>
      {open && (
        <div className="sharing-detail">
          {err && <p className="err" role="alert">{err}</p>}
          {t.status === "failing" && t.last_error && <p className="share-warn">{t.last_error}</p>}
          {t.kind === "friend" && t.status === "pending" && (
            t.connect_url
              ? <ConnectLink url={t.connect_url} nickname={t.nickname} />
              : <p className="sub">The connect link expired.</p>
          )}
          {t.kind === "friend" && (
            <div className="sharing-buttons">
              <button className="btn ghost" disabled={busy} onClick={() => run(async () => onChange(await api.newConnectLink(t.id)))}>
                {t.status === "pending" ? "New connect link" : "Reconnect with a new link"}
              </button>
            </div>
          )}
          <label className="share-note">
            <span className="sub">Nickname</span>
            <input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="sharing-buttons">
            <button className="btn" disabled={busy || !name.trim() || name.trim() === t.nickname}
              onClick={() => run(async () => onChange(await api.renameShareTarget(t.id, name.trim())))}>
              Save nickname
            </button>
            {confirmRemove ? (
              <button className="btn ghost" disabled={busy} onClick={() => run(async () => { await api.deleteShareTarget(t.id); onRemoved(); })}>
                Remove {t.nickname} and their history
              </button>
            ) : (
              <button className="btn ghost" onClick={() => setConfirmRemove(true)}>Remove…</button>
            )}
          </div>
          {sent && sent.length > 0 && (
            <>
              <span className="sub">Sent</span>
              <ul className="sharing-sent">
                {sent.slice(0, 20).map((s) => {
                  const d = s.deliveries.find((x) => x.target_id === t.id);
                  return (
                    <li key={s.id}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a>
                      <span className="share-sub">
                        {new Date(s.created_at).toLocaleDateString()}
                        {s.deliveries.length > 1 && <> · with {s.deliveries.filter((x) => x.target_id !== t.id).map((x) => x.nickname).join(", ")}</>}
                        {d?.error && <span className="share-warn"> · not delivered</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectLink({ url, nickname }: { url: string; nickname: string }) {
  const [done, setDone] = useState("");
  async function copy() {
    if (await copyText(url)) setDone("Copied");
  }
  async function share() {
    const r = await shareOrCopy({ title: "Connect to Otium", url });
    if (r === "copied") setDone("Copied");
  }
  return (
    <>
      <p className="sub">Send this link to {nickname}. It works once and lasts a week. They sign in with Discord and join the server the bot sends from.</p>
      <div className="sharing-link">{url}</div>
      <div className="sharing-buttons">
        <button className="btn" onClick={copy}>{done ? <><Check size={16} aria-hidden /> {done}</> : <><Copy size={16} aria-hidden /> Copy link</>}</button>
        {canWebShare() && <button className="btn ghost" onClick={share}><Share2 size={16} aria-hidden /> Share</button>}
      </div>
    </>
  );
}

function AddFriend({ onAdded }: { onAdded: (t: ShareTarget) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function add() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setErr("");
    try {
      onAdded(await api.addShareFriend(n));
      setName("");
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sharing-add">
      {err && <p className="err" role="alert">{err}</p>}
      <input className="field" placeholder="Friend's nickname" value={name} maxLength={60}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <div className="sharing-buttons">
        <button className="btn" onClick={add} disabled={busy || !name.trim()}>{busy ? "Adding…" : "Add friend"}</button>
      </div>
    </div>
  );
}

function AddChannel({ inviteURL, existing, onAdded }: { inviteURL: string; existing: ShareTarget[]; onAdded: (t: ShareTarget) => void }) {
  const [guilds, setGuilds] = useState<DiscordGuild[] | null>(null);
  const [guildID, setGuildID] = useState("");
  const [channelID, setChannelID] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    setErr("");
    api.discordChannels().then((gs) => {
      setGuilds(gs);
      if (gs.length === 1) setGuildID(gs[0].id);
    }).catch((e) => setErr(String(e.message ?? e)));
  }

  const guild = guilds?.find((g) => g.id === guildID);
  const used = new Set(existing.map((t) => t.guild_id + "/" + t.channel_name));
  const channel = guild?.channels.find((c) => c.id === channelID);

  async function add() {
    if (!guild || !channel) return;
    setBusy(true);
    setErr("");
    try {
      onAdded(await api.addShareChannel({
        nickname: name.trim(), guild_id: guild.id, guild_name: guild.name, channel_id: channel.id, channel_name: channel.name,
      }));
      setChannelID("");
      setName("");
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (!guilds) {
    return (
      <div className="sharing-add">
        {err && <p className="err" role="alert">{err}</p>}
        <div className="sharing-buttons"><button className="btn ghost" onClick={load}>Add a channel</button></div>
      </div>
    );
  }
  return (
    <div className="sharing-add">
      {err && <p className="err" role="alert">{err}</p>}
      <label className="share-note">
        <span className="sub">Server</span>
        <select className="field" value={guildID} onChange={(e) => { setGuildID(e.target.value); setChannelID(""); }}>
          <option value="">Pick a server</option>
          {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>
      {guild && (
        <label className="share-note">
          <span className="sub">Channel</span>
          <select className="field" value={channelID} onChange={(e) => {
            setChannelID(e.target.value);
            const c = guild.channels.find((x) => x.id === e.target.value);
            if (c && !name.trim()) setName("#" + c.name);
          }}>
            <option value="">Pick a channel</option>
            {guild.channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}{c.category ? ` (${c.category})` : ""}{used.has(guild.id + "/" + c.name) ? " - added" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {channel && (
        <label className="share-note">
          <span className="sub">Nickname</span>
          <input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <div className="sharing-buttons">
        <button className="btn" onClick={add} disabled={busy || !channel}>{busy ? "Adding…" : "Add channel"}</button>
      </div>
      {inviteURL && (
        <p className="sub">
          Server not listed? <a href={inviteURL} target="_blank" rel="noopener noreferrer">Add the Otium bot to it</a>, then <button className="linklike" onClick={load}>refresh the list</button>.
        </p>
      )}
    </div>
  );
}
