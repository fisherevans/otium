# Full-screen Shorts, and an aura while a clip gets ready

Fisher found that a Short scrolling in looked paused, with a Play button inviting a
tap it did not need. While a clip is loading or buffering (and not paused by you or
blocked by the browser) it now shows a slow, soft colour aura over the poster: three
drifting colour fields, transform/opacity only, still under reduced motion. He asked
for "the system is working" rather than a spinner. Play shows only after a
deliberate pause or a refused autoplay.

He also wanted Shorts to feel immersive, like TikTok/Reels. Full screen (default
on; a footer icon and an Actions switch) makes the reel cover the viewport for the
whole session and floats the header and pill over it, so card geometry is the same
for Shorts and articles and nothing resizes mid-swipe. Shorts go edge to edge, the
iframe scaled to cover a 9:16 box (metadata aspect is often missing, which read as
16:9 and over-cropped); articles are padded clear of the chrome. YouTube's own
title, logo and mute badge still draw inside the embed.

Two fixes found on the way: Next/Prev now scroll to index * height (scrollIntoView
center landed off in full screen), and the snap anchor no longer sets scrollTop
during an in-flight smooth scroll, which made Chromium land 48px off.

Issue: #184.
