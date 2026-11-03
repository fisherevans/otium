# One full-screen session view, no pill, and a reader pull that follows the finger

**Date:** 2026-11-03
**Type:** feature
**Author:** claude-code

## What changed

Every session now uses the full-screen view that #184 introduced for Shorts: the reel
covers the screen and the header floats over it. The full-screen toggle (the Short's
footer icon and the Actions switch) is gone, and its stored `otium:shorts-immersive:*`
preference is removed on load. Sessions have no bottom pill and no Next button. The
pill's jobs moved to the top bar: the time phrase sits beside the wordmark, a Library
icon and the ··· (item and session actions) sit on the right. Over a Short the bar
still steps aside for the clip's own bar, whose ··· opens the same sheet. The sheet
gained Next item, the non-gesture way to advance alongside the arrow keys. Loading,
error and session-complete screens dropped their pills too; each already had inline
buttons.

The full reader's end-of-article swipe is now a pull. From the first pixel of an
upward drag that starts at the bottom, the page moves with the finger and the reel
behind it scrolls by the same amount, so the next card rises from below, glued to the
page's bottom edge. Released past a quarter of the screen, or flicked, it settles onto
the next card; otherwise it springs back.

Shorts mode is unchanged: it still means large, autoplaying short-video cards, and it
still lives in Custom session and (in sessions with Shorts) the actions sheet. It no
longer has any say over the layout of other cards.

## Why

Fisher (#206): the full-screen toggle lived only on Shorts but changed the chrome of
every card in any session that contained a Short, and the difference for articles was
too subtle to be worth a setting. He prefers the simpler, fuller view everywhere. He
never used Next ("I've always just scrolled like TikTok"), so the pill that carried it
was taking space for nothing. In the reader, swiping up at the end showed nothing
moving until a threshold fired a fixed transition; it should feel like swiping to the
next post.

## How

- `SessionPage` sets `data-immersive` for the whole session (the attribute name is
  from #184) and publishes its time phrase and actions handler through
  `useInstrument`; `App` draws them in the session top bar instead of a pill. The
  over-video rule hides the bar with `visibility` after its fade, so its ··· leaves the
  accessibility tree and never doubles the Short's own.
- The Afterglow card hides its own action row (`.callout-act`), so the pill's ··· was
  the only way into Actions for articles and posts. The top bar's ··· is that way now.
- `ReaderPage`'s `usePull` writes the page transform directly (no React render per
  frame) and reports the offset through `onNextDrag`; `SessionPage` turns snapping off
  and scrolls the reel by the same offset (`readerPull`), and its anchor effect yields
  while a pull runs. The settle is one rAF loop driving both, so they cannot drift;
  reduced motion and e-ink settle at once. Commit lands the reel exactly on the next
  card and unmounts the reader without its exit slide.
- The pull cancels the first upward `touchmove` at the bottom, which keeps WebKit's
  rubber band and Chromium's overscroll out of it. The old 900ms limit is gone: a slow
  deliberate pull tracks and commits by distance. A drag that only reaches the bottom
  mid-gesture still scrolls natively (the browser owns that gesture by then); lifting
  and pulling again works.
- The layout solver needed no change: full screen already padded ordinary cards clear
  of the floating chrome and the solver holds that padding back when it centres
  (#205). The lab's shipped preset and `measure` now default to full screen
  (`--framed` measures the retired layout).

## Verification

`go test ./...`, `tsc`, `npm run build`; every `web/tools/verify-*` script in Chromium
and WebKit (verify-session-afterglow gained finger-tracking, follow and spring-back
checks for the pull); `measure` on the lab (default and `--shorts-mode`) and on the app
(`--viewing on` and `off`). Before/after screenshots and clips of the reader pull were
taken against a copy of the #205 snapshot.

Issue: #206.
