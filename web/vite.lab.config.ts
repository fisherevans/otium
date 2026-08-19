import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Build config for the standalone layout lab: one entry, no code splitting, no
// hashed names, so the output is trivially inlined into a single HTML file that
// can be opened or shared without a server. See tools/build-lab.mjs.
export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify("lab") },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: {
    outDir: "dist-lab",
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, "lab.html"),
      output: { inlineDynamicImports: true, entryFileNames: "lab.js", assetFileNames: "lab.[ext]" },
    },
  },
});
