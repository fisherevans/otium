# Apply Afterglow to production

**Issue:** #165
**Author:** codex

## What changed

Applied the approved Afterglow direction to the real application: Fraunces titles, bundled Newsreader reading font, a folded O with its corner at the upper right, warm light/dark palettes and the device-local e-ink presentation. The persistent contextual instrument replaces destination tabs and remains recognizable in sessions, readers and management screens. Existing routes remain available through the app menu.

The launcher offers an explicit custom setup, one-tap saved/default sessions and recent unsaved setups. Named presets retain duration, scope, media and Shorts choices. Media filtering occurs before source allocation, and the filtered queue stays durable; it does not alter ranking. Presets stay scoped to the signed-in account in browser storage.

Sessions retain the real queue, cursor, activity, players and curation controls. Brief taps open the shared reader; image hold opens the complete photograph. Reader continuation requires a deliberate bottom-origin swipe, with ordinary scrolling and other origins excluded. Endings offer Review session, with a condensed shown-item list, collection bookmarks and frozen activity stats. Extensions now persist their increased duration and active state on the server.

## Why

Fisher approved the Afterglow prototype after refining type, framing, the contextual bar, preset workflows and session review. The production change preserves existing source management, import, extraction, media, collections, history, insights and appearance capabilities. The focused behavior comes from the interaction design; interface copy uses factual state and action labels.

## Validation

Production build, Go tests, browser workflow checks and shared layout measurements pass. [Verification details](../docs/afterglow-verification.md) record coverage and limits. Browser emulation does not establish physical iPhone safe-area/keyboard or e-ink refresh behavior. Test writes use an isolated database or intercepted APIs, never the production account.
