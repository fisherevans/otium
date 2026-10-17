import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBack } from "@/lib/navigation";
import { api, type Settings } from "@/api/client";

// Settings (#68). A lightweight preferences surface, reachable from the library's
// Manage sheet. One toggle today: the fast-scroll check-in. The copy is
// deliberately transparent about what the measurement is and isn't - it powers a
// nudge, never a re-rank, and the data stays local. That transparency is the
// point (docs/decisions.md, "Intentionality & transparency").
export default function SettingsPage() {
  const nav = useNavigate();
  const back = useBack("/you");
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setErr("");
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => setErr(String(e.message ?? e)));
  }, [attempt]);

  const [reloading, setReloading] = useState(false);
  // Manual hard-refresh (#149): an installed PWA has no browser refresh, so give an
  // explicit escape hatch. Unregister the service worker, clear its caches, and
  // reload - the surest way to pull a fresh build when the auto-update check hasn't.
  async function hardRefresh() {
    setReloading(true);
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* best-effort - reload regardless */
    }
    location.reload();
  }

  function toggleFastCheckin() {
    if (!settings || saving) return;
    const next = !settings.fast_scroll_checkin;
    setSettings({ ...settings, fast_scroll_checkin: next }); // optimistic
    setSaving(true);
    setErr("");
    setSaved(false);
    api
      .updateSettings({ fast_scroll_checkin: next })
      .then((value) => { setSettings(value); setSaved(true); })
      .catch((e) => {
        setErr(String(e.message ?? e));
        setSettings((s) => (s ? { ...s, fast_scroll_checkin: !next } : s)); // revert
      })
      .finally(() => setSaving(false));
  }

  function toggleYouTubeHistory() {
    if (!settings || saving) return;
    const next = !settings.youtube_history;
    setSettings({ ...settings, youtube_history: next });
    setSaving(true);
    setErr("");
    setSaved(false);
    api
      .updateSettings({ youtube_history: next })
      .then((value) => { setSettings(value); setSaved(true); })
      .catch((e) => {
        setErr(String(e.message ?? e));
        setSettings((s) => (s ? { ...s, youtube_history: !next } : s));
      })
      .finally(() => setSaving(false));
  }

  return (
    <div>
      <button className="lib-back" onClick={back}>
        <span aria-hidden>←</span> Back
      </button>
      <div className="lib-topbar">
        <h1 className="display">Settings</h1>
      </div>

      {err && <div role="alert"><p className="err">{err}</p>{!settings && <button className="btn ghost" onClick={() => setAttempt((n) => n + 1)}>Retry</button>}</div>}
      {!settings && !err && <p role="status">Loading settings…</p>}
      {saving ? <p role="status">Saving…</p> : saved ? <p role="status">Saved</p> : null}

      {/* Appearance (#80/#81/#82): reader typography, card styling, and session
          presets, with a live preview. Its own screen so the preview has room. */}
      <button className="settings-link" onClick={() => nav("/settings/appearance")}>
        <div className="settings-copy">
          <b>Appearance</b>
          <span>Fonts, images, text size and session-duration choices.</span>
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
                Show a check-in after several quick skips, with options to continue or end the session. Turning this off disables skip-pace measurement and the check-in. It never changes ranking.
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

          {/* #151: let YouTube log in-app watches to your account history. */}
          <div className="settings-row">
            <div className="settings-copy">
              <b>Let YouTube log my watches</b>
              <span>
                Use youtube.com embeds instead of privacy-enhanced embeds. Watches can appear in your YouTube history when you are signed in and this browser allows YouTube cookies. This lets YouTube associate viewing here with your account.
              </span>
              {/* #151: otium can't detect YouTube sign-in (cross-origin), so the only
                  sure check is empirical - sign in, watch one, look at your history. */}
              <span className="settings-links">
                <a href="https://www.youtube.com/account" target="_blank" rel="noopener noreferrer">Sign in to YouTube ↗</a>
                <a href="https://www.youtube.com/feed/history" target="_blank" rel="noopener noreferrer">Check your history ↗</a>
              </span>
            </div>
            <button
              role="switch"
              aria-checked={settings.youtube_history}
              aria-label="Let YouTube log my watches"
              className={`switch ${settings.youtube_history ? "on" : ""}`}
              onClick={toggleYouTubeHistory}
              disabled={saving}
            >
              <span className="switch-knob" />
            </button>
          </div>
        </div>
      )}

      {/* #149: app version + manual refresh, for when an installed PWA is stuck on an
          old build. */}
      <div className="settings-row settings-about">
        <div className="settings-copy">
          <b>App version</b>
          <span>otium reloads itself when a new build ships. Force it here if something looks stale.</span>
        </div>
        <button className="btn ghost" onClick={hardRefresh} disabled={reloading}>
          {reloading ? "Reloading…" : "Reload"}
        </button>
      </div>

    </div>
  );
}
