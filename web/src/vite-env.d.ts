/// <reference types="vite/client" />

// Injected at build time (vite.config.ts define). The running build's id; compared
// against /version.json to detect a deployed update.
declare const __BUILD_ID__: string;
