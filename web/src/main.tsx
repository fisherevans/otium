import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { PreferencesProvider } from "@/context/PreferencesContext";
import App from "@/App";
import "@/styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <PreferencesProvider>
          <App />
        </PreferencesProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);

// PWA: register the service worker in production only (it would fight Vite HMR in
// dev). Makes otium installable ("Add to Home Screen" -> standalone app) and serves
// the immutable assets from cache. Failures are non-fatal - the app runs without it.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Auto-update (#149): an installed PWA has no browser refresh button, so a deployed
// update could otherwise strand the user on an old build. version.json is served
// no-cache and carries the deployed build id; whenever the tab becomes visible (and
// once on load) we compare it to the running build and reload if it moved. Hashed
// assets make the reload cheap. Debounced so a quick tab flip doesn't spam fetches.
if (import.meta.env.PROD) {
  let checking = false;
  let lastCheck = 0;
  const checkForUpdate = async () => {
    if (checking || Date.now() - lastCheck < 30_000) return;
    checking = true;
    lastCheck = Date.now();
    try {
      const r = await fetch("/version.json", { cache: "no-store" });
      if (r.ok) {
        const { buildId } = await r.json();
        if (buildId && buildId !== __BUILD_ID__) location.reload();
      }
    } catch {
      /* offline or transient - try again next time */
    } finally {
      checking = false;
    }
  };
  window.addEventListener("load", checkForUpdate);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
}
