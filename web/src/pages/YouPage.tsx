import { useNavigate } from "react-router-dom";
import { Settings, Palette, PieChart, Download, ChevronRight } from "lucide-react";

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
  { icon: Settings, label: "Settings", desc: "Preferences and ranking behavior.", to: "/settings" },
  { icon: Palette, label: "Appearance", desc: "Reader typography, cards, and session presets.", to: "/settings/appearance" },
  { icon: PieChart, label: "Insights", desc: "What each source actually is in your feed.", to: "/insights" },
  { icon: Download, label: "Import", desc: "Bring your follows in from OPML or Takeout.", to: "/import" },
];

export default function YouPage() {
  const nav = useNavigate();

  return (
    <div>
      <div className="lib-topbar">
        <h1 className="display">You</h1>
      </div>
      <p className="sub">Settings and the quieter corners of otium.</p>

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

      <p className="you-about">otium — attention, on purpose.</p>
    </div>
  );
}
