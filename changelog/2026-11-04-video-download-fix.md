# Download video saves the clip, not an error page

Fisher tapped Download video on a Short and got `<title>.mp4.html`, 6 KB (#211). Two
faults lined up:

- **yt-dlp and IPv6.** The server pod has no global IPv6 route. When yt-dlp picked an
  IPv6 googlevideo address it failed with `Network unreachable` and gave up after its
  single retry; the same clip downloaded fine minutes later. It now runs `--force-ipv4`
  with three retries (and three fragment retries).
- **The bare link.** Download was `<a href=".../video?download=1" download>`. A link
  navigation saves whatever body comes back, so a 502 (or the error page in front of it)
  became the "video", and from the installed iPhone app the navigation did not reliably
  carry the session (one answered 401 in 14µs). Download now does what Share already
  did: fetch the file with the app's session, check it is a video, then save the blob.
  A failure shows its message on the row. Share and Download reuse one fetched file.

The server still honours `?download=1` for anyone using the URL directly.
