import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type MultiFeedRule, type Settings } from "@/api/client";

// The multi-feed half-life rule options (#76). A source can live in several feeds
// with different freshness half-lives; this decides which one wins. "Primary"
// matches how feed identity already resolves (lowest-sorted feed), so it's the
// neutral default. A per-source override still beats whatever this resolves to.
const RULE_OPTIONS: { value: MultiFeedRule; label: string }[] = [
  { value: "primary", label: "Primary feed" },
  { value: "shortest", label: "Shortest" },
  { value: "longest", label: "Longest" },
];

// Settings (#68). A lightweight preferences surface, reachable from the library's
// Manage sheet. One toggle today: the fast-scroll check-in. The copy is
// deliberately transparent about what the measurement is and isn't - it powers a
// nudge, never a re-rank, and the data stays local. That transparency is the
// point (docs/decisions.md, "Intentionality & transparency").
export default function SettingsPage() {
  const nav = useNavigate();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  function toggleFastCheckin() {
    if (!settings || saving) return;
    const next = !settings.fast_scroll_checkin;
    setSettings({ ...settings, fast_scroll_checkin: next }); // optimistic
    setSaving(true);
    api
      .updateSettings({ fast_scroll_checkin: next })
      .then(setSettings)
      .catch((e) => {
        setErr(String(e.message ?? e));
        setSettings((s) => (s ? { ...s, fast_scroll_checkin: !next } : s)); // revert
      })
      .finally(() => setSaving(false));
  }

  function setRule(rule: MultiFeedRule) {
    if (!settings || saving || settings.multi_feed_rule === rule) return;
    const prev = settings.multi_feed_rule;
    setSettings({ ...settings, multi_feed_rule: rule }); // optimistic
    setSaving(true);
    api
      .updateSettings({ multi_feed_rule: rule })
      .then(setSettings)
      .catch((e) => {
        setErr(String(e.message ?? e));
        setSettings((s) => (s ? { ...s, multi_feed_rule: prev } : s)); // revert
      })
      .finally(() => setSaving(false));
  }

  return (
    <div>
      <button className="lib-back" onClick={() => nav("/sources")}>
        <span aria-hidden>←</span> Library
      </button>
      <div className="lib-topbar">
        <h1 className="display">Settings</h1>
      </div>
      <p className="sub">
        otium measures to serve your intention, never to grow time-in-app. Everything here stays on your own instance.
      </p>

      {err && <p className="err">{err}</p>}

      {/* Appearance (#80/#81/#82): reader typography, card styling, and session
          presets, with a live preview. Its own screen so the preview has room. */}
      <button className="settings-link" onClick={() => nav("/settings/appearance")}>
        <div className="settings-copy">
          <b>Appearance</b>
          <span>Reader typography, card styling, and session-length presets - with a live preview.</span>
        </div>
        <span className="settings-link-chev" aria-hidden>
          →
        </span>
      </button>

      {settings && (
        <div className="settings-list">
          <div className="settings-row">
            <div className="settings-copy">
              <b>Fast-scroll check-in</b>
              <span>
                If you're scrolling fast without opening, liking, or saving anything, otium shows a calm check-in - "want
                to keep going, or do something else?" It's a nudge toward self-honesty. It never re-ranks or changes your
                feed. Off: no dwell is measured and no check-in appears.
              </span>
            </div>
            <button
              role="switch"
              aria-checked={settings.fast_scroll_checkin}
              aria-label="Fast-scroll check-in"
              className={`switch ${settings.fast_scroll_checkin ? "on" : ""}`}
              onClick={toggleFastCheckin}
              disabled={saving}
            >
              <span className="switch-knob" />
            </button>
          </div>
        </div>
      )}

      {settings && (
        <div className="page-section">
          <div className="ctl-label">Preferences</div>
          <p className="sub" style={{ marginTop: 0 }}>
            Advanced ranking behavior. More knobs will live here over time.
          </p>

          <div className="settings-copy" style={{ marginBottom: 8 }}>
            <b>Multi-feed half-life</b>
            <span>
              When a source belongs to several feeds with different freshness half-lives, this decides which one
              applies. Primary feed uses the source's top feed (the default). Shortest fades those items fastest;
              longest keeps them around longest. A per-source override always wins over this.
            </span>
          </div>
          <div className="wbuckets">
            {RULE_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`wbucket ${settings.multi_feed_rule === o.value ? "on" : ""}`}
                onClick={() => setRule(o.value)}
                disabled={saving}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
