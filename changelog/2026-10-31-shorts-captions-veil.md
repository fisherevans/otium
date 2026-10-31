# Full-screen Shorts keep captions whole; a timed dissolve replaces the aura

Fisher's iPhone screenshot showed YouTube's captions cut off at the bottom of a
full-screen Short. The clip was scaled to cover the space between the header band
and the bottom strip, and on a phone (once safe areas are taken out) that space is
wider than 9:16, so cover cropped the top and bottom - where YouTube draws
captions and its title rows. Full screen now puts creator, time, sound, CC and ···
in one bar at the top and fits the clip to the width directly beneath it; it is
never cropped vertically, and a clip taller than the space letterboxes at the sides.
The Otium header hides over a Short; the bar's ··· reaches its menu. Next stays a
floating outline at the bottom-right.

He found the colour aura weird and clunky and asked for a dissolve whose timing
follows how long clips really take. The poster now settles under a dark veil over
the median of the last four measured starts on this device (1.2s before any), then
poster and veil dissolve into the video together; a slow start breathes gently.
Buffering mid-play is a plain quick dim.

The test fake player set an inline width/height the real IFrame API never sets,
which hid layout rules from the tests; it now mirrors the real attributes.

Issue: #189.
