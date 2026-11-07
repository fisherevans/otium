# Landscape clips in the reel: YouTube's start-of-play chrome is clipped

A landscape YouTube clip that plays in the full-screen Shorts reel showed YouTube's
start-of-play chrome for roughly 10 seconds on iPhone: title bar, a center pause button, and
a share / "more videos" / logo row. On a 30-second clip that's a third of it (#215).

**Why not hide it.** The player already runs with `controls:0`; this chrome is drawn
anyway. The IFrame API has no call that hides or shortens it, and a tap we synthesize can't
reach the cross-origin iframe. Pausing and resuming right after the start, hoping for a
shorter hide timer, was tried in headless Chromium: it brings the chrome back and restarts
the timer, so it was dropped.

**What changed.** The reel gave every clip a 9:16 iframe, so a landscape video letterboxed
and YouTube spread its chrome across the whole screen. A landscape clip (`.inline-media.h`)
now gets a box the shape of its picture, centered. The iframe bleeds 110px past it at both
ends inside a clipping mount, so the title bar is cut off.

- **Captions decide the bottom.** YouTube draws captions in the same bottom strip as the
  share row, so with captions on (the session default) the mount extends down over that
  strip, and the share row still shows below the picture for those seconds. With captions
  off (`data-cc=off` on the frame) the strip is clipped too.
- **The center pause button stays.** It's on the picture, so cropping can't reach it.
- Vertical Shorts are unchanged: fitted at 9:16, never cropped, so their captions and bottom
  rows stay whole.
- The incoming card's poster (`.shorts-player-slot`) now carries the `h`/`v` class so it
  matches the player's box and nothing jumps when the player takes over.

`tools/verify-shorts-playback.mjs` gets a scenario for the geometry and a mock for
`POST /items/{id}/view` (#196). The suite's older scenarios still time out behind the #213
sound card, which they don't dismiss; the new scenario taps Sound off first.
