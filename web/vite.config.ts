import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Dev: Vite proxies /api and /auth to the Go server on :8080.
// Prod: nginx does the same split (see web/nginx.conf), so the SPA always
// calls relative paths and never needs a build-time API base URL.
const webPort = Number(process.env.WEB_PORT ?? 5173);
const apiPort = Number(process.env.API_PORT ?? 8080);

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  server: {
    port: webPort,
    strictPort: true,
    host: true, // bind 0.0.0.0 so the phone can reach it over Tailscale
    allowedHosts: true, // Vite 6 blocks non-localhost Host headers otherwise
    proxy: {
      "/api": { target: `http://localhost:${apiPort}`, changeOrigin: true },
      "/auth": { target: `http://localhost:${apiPort}`, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
