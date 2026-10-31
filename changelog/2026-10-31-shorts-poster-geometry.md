# Full-screen Short posters no longer jump when the clip starts

Fisher's iPhone screenshots: mid-swipe, the incoming Short's poster was narrower
than the playing video, then jumped to full width when it started. The card layout
solver writes an inline height (`--card-frame-h`) on the focused card's video
frame; in full screen that overrode the frame's inset sizing, so as soon as the
card was focused (60% visible, before the player takes over) its poster shrank,
and the player - sized from the whole slot - appeared at full size. Full screen
now ignores the solver's inline height for Shorts frames, so the focused poster,
the next card's poster, the player's poster and the video share one box. A test
asserts the four boxes match; it fails without the fix.

Issue: #193.
