# A sound card before the first Short, instead of a tooltip

Sessions started muted and a one-time tooltip pointed at the speaker (#191). Fisher wanted
the choice up front (#213): the first time a session reaches a Short, a full card asks
"The next one plays sound" with **Keep audio off**, **Keep audio on** and **Skip videos this
session**.

- **Nothing is auto-chosen.** A first prototype counted down 3 seconds and took the last
  choice; Fisher rejected it. The last choice on this device is highlighted to draw the
  eye, and the card waits. That also removes an iOS trap: sound can only start inside a
  tap, so a timed "sound on" would have started muted. The choosing tap is the play
  (`shortsBus.controls.start`).
- **Remembered per device**, as the next highlight (`otium:sound-default`), not per account.
- **Skip videos** is server-side (`POST /sessions/{id}/skip-videos`): it drops the rest of
  the queue's short/long/live items so a resume does not bring them back. It does not
  refill the queue, so a mostly-video session ends sooner.
- "Keep this session quiet" from the prototype was dropped: it is the same as Keep audio off.
- Only Shorts autoplay, so nothing else gets the card.

Also fixed on the way: `useSessionPlayback` merged updates into the render's stale value,
so two updates in one tap (the card's answer, then the player's sound report) lost the first.
