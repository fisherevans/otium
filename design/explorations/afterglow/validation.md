# Afterglow browser verification

Verified October 16, 2026 against the standalone study in Chromium and WebKit. This records the prototype checks, not production app validation.

- All six typefaces, all four publisher fixtures and the illustrative video at 390x844, 320x740, 390x664 and 320x664: 240 brief/font/viewport checks across the two engines. No measured overflow or broken article images. The narrowest long-headline case uses a 21px title and 16px teaser.
- Eighteen routes captured in each engine, plus font specimens, article options, media and e-ink states. Mobile and desktop rendered with the shared `shot` tool; screenshots inspected.
- Next advances one item. Vertical scrolling updates the active brief. The time boundary and the terminal page both reach the ending; opening article options does not advance.
- Typeface changes retain the current article and scroll position. The font and session cursor survive reload. Leaving for Library and returning retains position.
- Reader returns to its originating session or Saved screen, including after refreshing the reader.
- Multi-collection saving, new collections, saved-date sorting and saved video playback work locally. Saved categories remain selected after reopening the filter sheet and editing keywords.
- Duration and scope changes do not start a session until Begin. Ending does not restart until an explicit extension choice.
- Source preferences persist locally. Source addition and URL import have review steps before local confirmation.
- E-ink uses light paper and grayscale; the choice persists between screens. Video starts paused, plays on request, and pauses when opening a sheet or moving offscreen.
- Correct Back targets for Outdoors/Culture. No page errors during the exercised flows.

The interaction walkthrough used Playwright and browser scroll/IntersectionObserver behavior. It does not establish physical finger-swipe feel, iOS Safari chrome/keyboard behavior, PWA safe-area behavior, or e-ink refresh performance. Production account APIs, extraction, YouTube/Shorts, podcasts and full import behavior are outside this local prototype.

## New-session walkthrough extension

Chromium and WebKit both passed Start > time > scope > exclude Politics > Begin, producing the expected Vermont/technology/video sample. Open/save/return, reload of the selected plan and cursor, Library return, natural-language phases and finite ending passed. Starting again with Vermont produced a different set; video-only scope also reached the ending by scrolling. Draft edits left the active plan unchanged. Empty topic selections disabled Begin, and re-including topics restored it even when closing with X or Escape. Fresh entry has no invented Resume; explicit full-fixture comparison remains available.

The complete journey also passed WebKit at 320x664. Three motion clips were captured with the shared `clip` tool and real browser touch events: start/setup/Begin, read/save/return/swipe, and advancing to the ending. Assertions confirmed that a touch swipe advanced exactly one item and the final action reached End. Clips are embedded in the design notes. This remains browser touch emulation, not a physical-device check.
