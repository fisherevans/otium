# Shorts viewing mode

Short videos were competing with large headlines, taxonomy and action rows for the
same phone screen. Fisher wanted the video itself to dominate, with the context
available when needed, and autoplay as part of that viewing choice.

Shorts mode now gives short-video cards the available stage while preserving the
whole frame. A compact creator/date footer and Details replace the ordinary title
and action rows. Details contains the headline, description, save/share, source
controls and mode switch. Articles and longer videos keep their existing cards.
The shared runtime solver and layout lab cover both layouts.

The mode starts on and is remembered per account in this browser, independently of
feed presets. Custom session exposes it before Start; the session sheet can change
it while browsing. It never changes the selected content types or source scope.

The focused short autoplays muted. A visible sound control carries an explicit
sound choice between clips; browsers that block an audible start fall back to mute.
If autoplay is blocked entirely, Play remains available. Unavailable embeds offer
Open original. Switching the mode off pauses and restores manual playback with
sound. Only the focused card owns a player; hidden pages and open dialogs pause
it, and a deliberate pause or an ended video stays paused. Native YouTube controls
remain available. No automatic next, looping or session extension was added.

Playback accounting now distinguishes actual automatic playback from an explicit
open. Only explicit interaction emits open/engagement. Automatic playback counts
as a played video, not a rejected headline or a fast-scroll check-in. Timers stop
on pause, buffering, hide, sheets and unmount, rather than continuing after the
first play. These observations do not alter ranking.

The browser lifecycle harness uses a deterministic YouTube API double for blocked,
late, stale and failed player events. Real YouTube embed checks are separate from
those contract tests. Browser emulation does not establish physical iPhone behavior.

References: [YouTube player events](https://developers.google.com/youtube/iframe_api_reference#Events)
and [WebKit autoplay policy](https://webkit.org/blog/6784/new-video-policies-for-ios/).
Tracking: #174 and nottingham-cloud#961.
