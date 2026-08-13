# Reader flicker + swipe-to-next, recap redesign, video card, tone pass

**Date:** 2026-08-13
**Type:** feature
**Version:** v0.68.0
**Author:** claude-code

## What changed

A batch from Fisher testing on his phone (issue #149):

- **Reader image flicker fixed (for real).** The article reader's parsed body was
  being re-committed to the DOM every second, reloading every `<img>` and bouncing
  the text below. Memoizing the article element on its HTML string stops it.
- **Swipe up at the bottom of a reader -> next feed item.** An upward flick at the
  end of an article closes the reader and advances the feed as if you scrolled to
  the next card.
- **Session recap redesigned into a plain ledger.** Articles opened, videos played,
  audio played (each with its own time), headlines passed (+ the rest of the time),
  time away from otium, and sources exposed to - rows omitted when their value is
  < 1 - with the **session total at the bottom**. Removed the "intentionally" lead
  and the "You're caught up enough. Come back when you like." line.
- **Video card layout + fullscreen button.** The player now sits directly under the
  card metadata (was centered, leaving a dead gap); the in-card fullscreen button is
  removed.
- **Tone pass.** Defined otium's tone in `design/EXPERIENCE.md` and swept the app of
  spa-advertisement "thoughtfulness" copy.

## Why

- **Flicker:** the earlier #142 fix keyed the body-*load* effect on `itemId` so the
  content stopped being re-*parsed*, but the flicker persisted in the deployed
  v0.67.3. Reproduced with a headless-Chromium MutationObserver: the `.reader-body`
  element was stable, its `body.html` string was stable, and the load effect ran
  exactly once - yet the whole parsed subtree (figure + every `<p>`) was removed and
  re-inserted once per second, matching SessionPage's active-time ticker. React was
  re-committing `dangerouslySetInnerHTML` on each parent-driven re-render. Wrapping
  the article `<div>` in `useMemo([body?.html])` makes its element reference stable,
  so React skips the subtree entirely. Verified: reader-body mutations dropped from
  ~1/sec to 0 over 6s.
- **Swipe-to-next:** finishing an article previously meant swipe-back-then-swipe-next
  - two gestures. At the bottom there's nothing left to scroll, so an upward flick is
  the natural "give me the next one." Armed only when the gesture starts at the
  bottom, so a normal upward scroll mid-article never triggers it.
- **Recap:** the old recap editorialized ("you spent N minutes *intentionally*",
  "you're caught up *enough*") and under-reported where the time went. Fisher wanted
  a clean factual account of the session: what he consumed, how long each took, how
  much time was spent skimming headlines vs away, and how many sources he was exposed
  to - and to draw his own conclusion from the numbers.
- **Fullscreen button:** it did nothing on Fisher's iPhone. iOS Safari can't
  fullscreen a `<div>`-wrapped cross-origin iframe (`requestFullscreen` is a no-op on
  a non-video element there), so the whole custom-fullscreen apparatus was dead on
  the primary device while being a dark, distracting control over the video. Native
  fullscreen + scrubbing is still one tap away via "Open original" (the native
  YouTube player). The wasted vertical centering of the player was the other half of
  the same screenshot's complaint.
- **Tone:** the app had accumulated meditation-app landing-page copy ("a calmer way
  to keep up", "missing things is okay", "nudge toward self-honesty", "restraint is
  virtuous"). Fisher's tone for otium: **simple, smart, clean, utilitarian** - not
  rigid/aggressive/strict - which pursues the app's goals by **giving the user facts
  and letting them decide, never telling them what to do or how to feel.** That's now
  the written contract in `design/EXPERIENCE.md`, so it doesn't drift back.

## Follow-ups

- **YouTube account integration** was scoped out of this pass into its own milestone
  (epic #143, sub-issues #144-#148): SSO into YouTube, seed subscriptions, reflect
  watched/started state, mark videos done in-app, and sync collections <-> playlists.
