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
