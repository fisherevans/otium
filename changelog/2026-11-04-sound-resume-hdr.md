# Sound comes back after returning to the app; HDR limited where browsers allow

**Sound (#214).** iOS only starts sound inside a tap. Returning to Otium, or coming back
from the share sheet, resumes the clip without one, so the player fell back to muted, and
that fallback stuck for every following clip. The saved choice was intact but never
re-applied. Now the fallback waits for the next tap anywhere (`touchend`/`click`, capture
phase) and restores the saved sound inside it. A tap on the clip while it waits only
restores sound; it does not also pause. A tap on a sound control is left to that control.

**HDR.** `iframe, video { dynamic-range-limit: standard; }` keeps HDR video at standard
range where the browser supports it (Chromium 136+). Safari and iOS Safari did not
support the property as of this change, and YouTube's embed has no parameter to turn
HDR off, so on the iPhone this is a no-op until WebKit ships it.
