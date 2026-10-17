# Otium experience

Otium assembles finite sessions from selected sources. Shown and opened counts help the reader make decisions; they never train the ranking or optimize engagement.

## Devices and identity

The iPhone is the primary device. E-ink remains a supported presentation, selected in Appearance for that browser. Standard uses short transitions and the account's image-color choice. E-ink uses grayscale and immediate changes. System reduced-motion is independent and always respected. Both presentations keep the same hierarchy, readable contrast, and generous controls.

The folded O is the app's mark: one closed reading space and an inward page fold. The fold sits at the upper right. Its vector sources live in `web/public/icons/`, with a matching inline mark in `Brand.tsx`. Icon URLs include the identity name so a new identity bypasses old browser and service-worker caches. The app icon uses warm gold on ink; the header inherits the current theme. Keep the mark recognizable at favicon size, without fine strokes or color-dependent meaning.

Interface icons use monochrome inline SVGs from the existing Lucide set. Never use emoji or Unicode pictographs as control icons, including CSS-generated content: their presentation varies by operating system. Article content is separate.

## Navigation and task hierarchy

The persistent bottom instrument changes with the task: session options and Next while browsing, Back while reading, and page actions elsewhere. Its folded O, role label and geometry remain recognizable. Short transitions indicate the change; e-ink and reduced motion use immediate changes. A header menu reaches New session, Library, Saved and Your Otium. Existing routes remain valid. Back returns to the originating context with a stable parent fallback. Saved filters, collection selection and sorting live in the URL; returning to lists restores position.

New session leads with a prominent Custom session action, a one-tap default, saved presets and recent unsaved setups. Custom keeps duration, section and media type on one screen. Multiple sections, topic exclusions and Shorts are available as explicit options. The common phone path fits without scrolling. A failed library load shows Retry, never a false empty-library welcome. A second consecutive use of an unsaved setup offers to save it outside the active session; saving is always explicit. Presets and recent setups are account-keyed browser storage; they do not replace account appearance preferences.

Library leads with Add source and Import. Adding chooses a topic, or creates one inside a section, before identifying the source. Organization is secondary. Source and topic edits keep the dialog and draft open on failure. A partially created source can finish setup on retry without duplicating it.

You leads with Settings, Appearance, Insights and Reading history. Reading activity is an explicit disclosure. There are no streaks, badges or engagement targets.

## Reading

A session presents one item at a time. The card combines source and topic context, a restrained headline, creator/date, contained imagery and a short summary. Fraunces supplies titles; Newsreader is the default reading face. Existing alternate reading-font choices remain available. Headline and content carry the emphasis. Shared `SessionCard` markup and the runtime solver own this layout; Appearance and the layout lab use those same surfaces.

Every article opens the same full-page reader, including from Saved, History and source articles. The reader requests extracted content, preserves available text on failure, and offers Retry. Browser Back, the visible Back button and Escape return to the originating context. Media shares `InlineMedia`, begins paused, and keeps controls separate from navigation gestures.

The active session is durable. Going to Library preserves the cursor and offers Return to session. End session opens Session complete. Review session lists only items actually shown, with individual collection bookmarks and stats for articles opened, video/audio plays, skips and time. Completed stats are frozen so review actions do not rewrite the session. Detailed per-kind and away-time measurements remain available. When the time budget is reached, the current item remains readable; the next advance reaches the ending. Continuing is an explicit choice.

## Interface copy

Use factual state and action labels. Remove affirmations, permission-giving, emotional validation, meditative slogans and text that tells users how to feel. Focus is implemented through the workflow; the interface does not narrate that philosophy. "Session complete" states the outcome. "You made some room" and "The rest can wait" do not help the user operate the app.

Apply this to headings, dialogs, empty states, utility bars, preset defaults and generated type specimens. Delete unnecessary copy instead of replacing it with a different slogan. Natural-language remaining-time status such as "A little time left" remains useful. Article content is separate from interface copy.

## Interaction contract

- Primary and icon actions have at least 44px touch areas. Glyph size is independent of hit area. Utility metadata uses system sans; titles and primary reading controls use the Afterglow serif faces. Article text retains the chosen reading face.
- The non-media brief is a reading target. Image hold opens the full photograph; drag cancels tap and hold does not also open the reader. Embedded players and controls own their input.
- A deliberate upward gesture that starts at the bottom of a session reader advances one item. Ordinary scrolling, short/diagonal/cancelled gestures, multiple touches, text selection and zoom do not. Swipe-right Back and visible buttons provide alternatives. Saved and review readers never advance the active queue.
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
