# Afterglow browser verification

Earlier rounds verified October 16, 2026 against the standalone study in Chromium and WebKit. This records the prototype checks, not production app validation.

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

## Selected pairing and reading refinement

The current pass uses Fraunces titles and Newsreader reading. Chromium, WebKit and Firefox each passed 15 brief/viewport checks (five fixtures at 390x844, 390x664 and 320x664), with no brief overflow and all article photographs using contained framing. All 15 tested surrounding routes retained the same instrument height. Broad brief taps, image taps, hold-to-view, the explicit viewer, reader continuation and Saved-origin return passed without page errors in all three engines.

The full new-session journey was rerun in WebKit at 320x664, including selection, save/return, reload persistence, draft isolation, empty choices, video and ending. Seven current clips were captured with the shared clip tool using browser touch input: setup/Begin, read/save/return, ending, image hold, ordinary scroll followed by bottom continuation, swipe-right Back, and instrument role changes. Assertions checked that ordinary scrolling never advanced, bottom continuation advanced exactly once, and Back retained position.

Additional Chromium checks verified image drag cancellation, a 1.4-second hold without opening the reader, browser Back dismissing an open Save sheet, and reduced-motion route changes producing no animations. Synthetic touch-event guard checks covered short, diagonal, initially vertical then rightward, slow, cancelled, multi-touch and text-selection gestures; all stayed in the reader. Saved-origin upward gestures did not advance the queue. These synthetic guard tests complement, rather than replace, the browser-input recordings.

Screenshots from Firefox's short viewport and the other engines were visually inspected. Firefox here is Linux Firefox, not Firefox on a physical iPhone. Installed-PWA safe areas, native edge gestures, keyboard/browser chrome and physical e-ink behavior still require device verification. No production code or account data changed.

## Preset-first session launcher

Chromium, WebKit and Firefox passed the default 10-minute news launch and 40-minute video preset, custom setup, recent reuse, repeat suggestion, saving/default selection and reload persistence. Checks also covered active-plan isolation, empty media/topic selections, enabling Begin after restoring a topic, editing/removing presets, and extension durations not replacing the original type offered for saving. Dismissed repeat suggestions stayed dismissed.

The populated launcher and custom screen each fit without scrolling at 320x568, 320x664, 390x664 and 390x844 in all three engines (24 route/viewport checks). Short screens show one secondary preset with All available. Custom stays in the instrument when an active session makes Resume the primary action. Long labels truncate rather than expanding the launcher; full setup details remain available through its controls.

Three updated browser-touch recordings cover one-tap default launch, the one-screen custom path, and a recent setup becoming a named default preset after its second use. Earlier setup recordings and checks above describe the preceding design. All interactions remain local simulations; physical-device limits still apply.

## Factual copy and prominent custom setup

Rechecked the session/preset flow in Chromium, WebKit and Firefox after moving Custom session into the main content above the default. The launcher and custom screen still fit at 320x568, 320x664, 390x664 and 390x844, including populated, active-session and long-name states. Screenshots of start, setup, ending, settings and Saved were inspected.

A rendered-copy walk covered 16 routes and 12 dialogs. The original seed names migrate to News and Video, while a user-renamed preset stays unchanged. Seven current motion clips were refreshed to show the factual copy and main-screen custom action. No page errors occurred during the checks. Physical-device limitations remain unchanged.

## Completed-session review

Chromium, WebKit and Firefox passed a three-item review with one opened article, one skipped article and an item left on screen when ending explicitly. The list contains only items shown. Stats record actual prototype time, not the selected duration. Video playback is recorded separately. Saving during the session prevents a forward skip; leaving for Library pauses time.

Per-row collection selection, collection creation, removal and closing with Escape update the correct bookmark. Opening a reviewed article returns to Review session without offering session continuation. Stats remain unchanged after review actions and reload. Extensions retain activity; starting a new session resets it. No page errors occurred. Two browser-touch clips show ending/review and saving/reopening. These checks remain browser emulation, not physical iPhone or PWA validation.

Additional Chromium checks verified that hidden-document time is excluded and Review session restores its scroll position at 320x568. The existing preset launcher suite passed again, including compact setup, repeat suggestions, default selection, reload, empty choices and draft isolation. Start/custom/preset recordings were refreshed for the new ending.
