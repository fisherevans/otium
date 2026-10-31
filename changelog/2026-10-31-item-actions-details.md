# Separate item Details from Actions; share the video file

Fisher found the card's Details and the pill's ··· opened the same menu, with no
way to share or download the clip, share its link, open its channel or open it in
YouTube. He also wanted to see how long a video is and how much is left.

Details now holds provenance: source, topic, date, reason, score, representation
and filters. Actions holds what to do: save or share the video file, download it,
share or copy the link, open in YouTube, open the channel, go to the source, save,
then Shorts mode and End session. Each links to the other.

The server gains `GET /items/{id}/video`, which fetches YouTube videos up to three
minutes as H.264/AAC MP4 with yt-dlp (node as its JavaScript runtime, ffmpeg to
merge) and caches them beside the database for a week. Fisher had confirmed on his
iPhone earlier the same day that a file-only Web Share reaches Save Video; a shared
caption turned into an extra item, so only the file is shared. yt-dlp has to track
YouTube closely and release images are never rebuilt, so the server keeps its own
copy on the data volume and self-updates it at most daily.

A live "0:33 left / of 0:45" readout sits beside Sound, CC and Player. At 400px
and narrower the Player label collapses to its icon so the row fits at 320px.

Issue: #180.
