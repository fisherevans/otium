// Otium service worker. Minimal + auth-safe: it exists mainly to make the app
// installable (a fetch handler is required) and to serve the immutable hashed
// assets fast. It NEVER caches /api, /auth, or /healthz, so authed data is always
// fresh and the OIDC flow is never intercepted.
const CACHE = "otium-static-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname === "/healthz") return;
  // Vite's hashed bundles + our icons are immutable: cache-first.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(e.request).then(
          (hit) =>
            hit ||
            fetch(e.request).then((r) => {
              if (r.ok) c.put(e.request, r.clone());
              return r;
            }),
        ),
      ),
    );
  }
  // Everything else (navigations, manifest) falls through to the network.
});
