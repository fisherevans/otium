# PWA auto-update + dark-mode text contrast

**Date:** 2026-08-14
**Type:** fix
**Version:** v0.71.0
**Author:** claude-code

## What changed

- **Installed PWAs now update themselves.** The app shell (`index.html`) and a new
  `version.json` are served `no-cache`, each build stamps a `__BUILD_ID__`, and the
  running app compares it to the deployed `version.json` on load and whenever the tab
  becomes visible - reloading if they differ. A manual "Reload" escape hatch in
  Settings unregisters the service worker, clears its caches, and reloads.
- **Dark-mode text contrast.** Dark mode was reusing the light-mode muted inks
  (`--ink-soft`, `--ink-mute`), which read as unreadable grey-on-black. Dark mode now
  has its own lifted values. The hardcoded semantic green/rust (open/read vs
  skip/danger) were tokenized (`--good`/`--bad` + chip tints) with dark variants, so
  they're legible on the near-black paper instead of ~1.5:1.

## Why

Both from Fisher on his installed PWA:

- **Caching:** `index.html` had no `Cache-Control`, so browsers heuristically cached
  the shell and an installed PWA stayed pinned to an old build with no browser
  refresh button to escape it. The shell must revalidate every load (hashed
  `/assets/` stay immutable, so it's cheap), and the app needs to notice a new build
  and reload on its own - a standalone PWA can't be hard-refreshed by hand.
- **Contrast:** the new dark mode inherited muted text colors tuned for dark ink on
  cream; on black they were too dark to read. Muted metadata, dates, reason lines,
  and the good/bad status colors all needed dark-specific values.

Part of issue #149.
