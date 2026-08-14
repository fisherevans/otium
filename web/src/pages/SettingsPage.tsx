import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Settings } from "@/api/client";

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
    api
      .updateSettings({ fast_scroll_checkin: next })
      .then(setSettings)
      .catch((e) => {
        setErr(String(e.message ?? e));
        setSettings((s) => (s ? { ...s, fast_scroll_checkin: !next } : s)); // revert
      })
      .finally(() => setSaving(false));
  }

  return (
    <div>
      <button className="lib-back" onClick={() => nav("/sections")}>
        <span aria-hidden>←</span> Library
      </button>
      <div className="lib-topbar">
        <h1 className="display">Settings</h1>
      </div>
      <p className="sub">
        otium tracks nothing for engagement or time-in-app. Everything here stays on your own instance.
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
                After a run of cards passed without opening, liking, or saving anything, otium surfaces a check-in with the
                count and two options: keep going or end the session. It never re-ranks or changes your topic. Off: no dwell
                is measured and no check-in appears.
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
