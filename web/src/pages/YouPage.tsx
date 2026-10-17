import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings, Palette, PieChart, History, ChevronRight, Minus, Plus } from "lucide-react";
import { api, type ReadingStats } from "@/api/client";

function fmtMin(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// The You tab (#84, Model A). A calm launcher for the secondary destinations
// that used to be buried in the Library's Manage sheet: Settings, Appearance,
// Insights (the insights view), and Import. Just rows that navigate to the existing
// pages - nothing here rebuilds them. A quiet About line closes the list.
type Dest = {
  icon: typeof Settings;
  label: string;
  desc: string;
  to: string;
};

const DESTS: Dest[] = [
  { icon: Settings, label: "Settings", desc: "Session behavior and playback.", to: "/settings" },
  { icon: Palette, label: "Appearance", desc: "Reader typography, cards, and session presets.", to: "/settings/appearance" },
  { icon: PieChart, label: "Insights", desc: "How your sources shape each session.", to: "/insights" },
  { icon: History, label: "Reading history", desc: "Return to articles you have seen or read.", to: "/saved?view=history" },
];

export default function YouPage() {
  const nav = useNavigate();
  const [showStats, setShowStats] = useState(false);
  const [statsAttempt, setStatsAttempt] = useState(0);
  const [statsError, setStatsError] = useState("");
  const [rs, setRs] = useState<ReadingStats | null>(null);

  useEffect(() => {
    if (!showStats || rs) return;
    setStatsError("");
    api.readingStats().then(setRs).catch((e) => setStatsError(String(e.message ?? e)));
  }, [showStats, rs, statsAttempt]);

  // Show the reading summary only once there's something to reflect. Descriptive,
  // never a scoreboard (#135) - it answers "how do I read", it doesn't grade you.
  const hasStats = !!rs && (rs.sessions > 0 || rs.reads_in_app > 0 || rs.reads_external > 0);

  return (
    <div>
      <div className="lib-topbar">
        <h1 className="display">You</h1>
      </div>
      <p className="sub">Preferences and reading activity.</p>

      <div className="you-list">
        {DESTS.map((d) => {
          const Ic = d.icon;
          return (
            <button key={d.to} className="settings-link" onClick={() => nav(d.to)}>
              <Ic size={20} strokeWidth={1.75} aria-hidden />
              <div className="settings-copy">
                <b>{d.label}</b>
                <span>{d.desc}</span>
              </div>
              <span className="settings-link-chev" aria-hidden>
                <ChevronRight size={18} strokeWidth={1.75} />
              </span>
            </button>
          );
        })}
      </div>

      <button className="settings-link" aria-expanded={showStats} onClick={() => setShowStats((v) => !v)}>
        <PieChart size={20} strokeWidth={1.75} aria-hidden />
        <span className="settings-copy"><b>Reading activity</b><span>A descriptive summary of your reading.</span></span>
        <span aria-hidden>{showStats ? <Minus size={18} className="inline-icon" aria-hidden /> : <Plus size={18} className="inline-icon" aria-hidden />}</span>
      </button>
      {showStats && <div>
        {statsError && <div><p className="err" role="alert">{statsError}</p><button className="btn ghost" onClick={() => setStatsAttempt((n) => n + 1)}>Retry</button></div>}
        {!rs && !statsError && <p role="status">Loading activity…</p>}
        {rs && !hasStats && <p className="sub">Your reading activity will appear here after a session.</p>}
      {hasStats && rs && (
        <div className="you-stats">
          <div className="you-stats-grid">
            {rs.sessions > 0 && (
              <div className="you-stat">
                <span className="you-stat-n">{rs.sessions}</span>
                <span className="you-stat-l">{rs.sessions === 1 ? "session" : "sessions"}</span>
              </div>
            )}
            {rs.read_min_in_app > 0 && (
              <div className="you-stat">
                <span className="you-stat-n">{fmtMin(rs.read_min_in_app)}</span>
                <span className="you-stat-l">reading in-app</span>
              </div>
            )}
            {rs.reads_in_app > 0 && (
              <div className="you-stat">
                <span className="you-stat-n">{rs.reads_in_app}</span>
                <span className="you-stat-l">read here</span>
              </div>
            )}
            {rs.avg_read_sec > 0 && (
              <div className="you-stat">
                <span className="you-stat-n">
                  {rs.avg_read_sec >= 60 ? `${Math.round(rs.avg_read_sec / 60)}m` : `${rs.avg_read_sec}s`}
                </span>
                <span className="you-stat-l">avg per read</span>
              </div>
            )}
          </div>
          {rs.reads_external > 0 && (
            <p className="you-stat-note">
              {rs.reads_external} opened on the original site (read time not measured there).
            </p>
          )}
          {rs.by_topic.length > 0 && (
            <div className="you-bytopic">
              <div className="you-bytopic-h">Time spent by topic</div>
              {rs.by_topic.map((t) => (
                <div className="you-bytopic-row" key={t.name}>
                  <span className="you-bytopic-name">{t.name}</span>
                  <span className="you-bytopic-min">{fmtMin(t.min)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      </div>}

    </div>
  );
}
