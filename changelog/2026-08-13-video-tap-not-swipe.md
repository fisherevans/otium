# Video: pressing play no longer jumps to the next item

**Date:** 2026-08-13
**Type:** fix
**Version:** v0.69.1
**Author:** claude-code

## What changed

On the in-feed video player, navigation now requires a genuine *flick* - past the
distance threshold AND fast (< 400ms). A tap, a sloppy tap, or a slow drag is
treated as play/pause and never advances the feed.

## Why

Fisher: "pressing play on a video freezes the page a bit, then just advances to
the next feed item." The gesture overlay classified swipe-vs-tap on distance
alone. Pressing play janks the main thread while YouTube buffers; if the finger
drifts up ~45px+ during that freeze, the release carried a large `dy` and was read
as swipe-up -> next. Reproduced headlessly: a slow 60px upward drift advanced the
feed. Requiring a flick to be fast (not just far) means a freeze-induced drift -
which is slow - falls through to play/pause instead. Verified: tap plays, slow
up-drift no longer advances, a real fast flick still advances. Part of #149.
