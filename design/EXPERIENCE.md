# Otium experience

Otium makes spending attention on purpose feel good. It assembles finite sessions from sources the reader chose. Shown and opened counts help the reader make decisions; they never train the ranking or optimize engagement.

## Devices and identity

The iPhone is the primary device. E-ink remains a supported presentation, selected in Appearance for that browser. Standard uses short transitions and the account's image-color choice. E-ink uses grayscale and immediate changes. System reduced-motion is independent and always respected. Both presentations keep the same hierarchy, readable contrast, and generous controls.

The folded O is the app's mark: one closed reading space and an inward page fold. Its vector sources live in `web/public/icons/`, with a matching inline mark in `Brand.tsx`. Icon URLs include the identity name so a new identity bypasses old browser and service-worker caches. The app icon uses paper on ink; the header inherits the current theme. Keep the mark recognizable at favicon size, without fine strokes or color-dependent meaning.

## Navigation and task hierarchy

Four persistent destinations: Read, Library, Saved, You. Descendant routes retain their parent's selected tab. Back returns to the actual preceding app route, with a stable parent fallback for direct links. Saved filters, collection selection and sorting live in the URL; returning to lists restores position.

Read asks how long, then what to read. The chosen duration and scope stay visible above Begin session. Choosing a section changes the scope; it never begins a session. Customize topics is optional. The last successful scope is remembered on this device. A failed library load shows Retry, never a false empty-library welcome.

Library leads with Add source and Import. Adding chooses a topic, or creates one inside a section, before identifying the source. Organization is secondary. Source and topic edits keep the dialog and draft open on failure. A partially created source can finish setup on retry without duplicating it.

You leads with Settings, Appearance, Insights and Reading history. Reading activity is an explicit disclosure. There are no streaks, badges or engagement targets.

## Reading

A session presents one item at a time. The card's order is section/topic, headline, creator/date, media or summary, actions. Headline and content carry the emphasis. Shared `SessionCard` markup and the runtime solver own this layout; Appearance and the layout lab use those same surfaces.

Every article opens the same full-page reader, including from Saved, History and source articles. The reader requests extracted content, preserves available text on failure, and offers Retry. Browser Back, the visible Back button and Escape return to the originating context. Media shares `InlineMedia`, begins paused, and keeps controls separate from navigation gestures.

The active session is durable. Going to Library preserves the cursor and offers Return to session. End session opens the recap. When the time budget is reached, the current item remains readable; the next advance reaches the ending. Continuing is an explicit choice.

## Interaction contract

- Primary and icon actions have at least 44px touch areas. Glyph size is independent of hit area. UI uses system sans; reading retains the chosen serif or sans face.
- A press can advance only when it began on that card, owns the same primary pointer at release, and moved predominantly left. Cancel, a second touch or zoom cancels navigation. Action rows and embedded players own their gestures.
- Reading supports vertical scrolling and pinch zoom. Short standard transitions establish the starting position before animating. Reduced-motion and e-ink transitions are immediate.
- Sheets, edit dialogs, readers and image viewers use named native modal dialogs. Background content is inert; focus stays in the top dialog, Escape closes that dialog, and closing restores focus.
- Errors appear where the action happened. No success message follows a failed save. Existing settings remain intact unless the reader changes them.

## Verification

Run the frontend build and Go tests. Measure all layout fixtures and real sessions, including 320px width and the Palma frame. Walk the start/read/save/back/end loop in Chromium and WebKit; verify failed loads and saves, nested modal focus, reduced motion, dark mode, and local e-ink persistence. Use real touch input for gestures and inspect motion frames. Browser emulation does not establish physical iPhone keyboard or e-ink refresh quality.

The reusable browser regressions run against a local Vite dev server:

```sh
BASE_URL=http://127.0.0.1:5173 node web/tools/verify-overlays.mjs
node web/tools/verify-appearance.mjs http://127.0.0.1:5173
```

They intercept the APIs they modify and do not write account data. Install the matching Playwright Chromium/WebKit engines before running them. The overlay harness also accepts `PLAYWRIGHT_MODULE` for an existing matched installation.
