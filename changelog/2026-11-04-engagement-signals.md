# Likes, dislikes and per-view engagement, read back per channel

Fisher wants to look back over a month and see which channels he skips every time and
which he likes, so he can prune his follows (#196). Otium already logged open/skip/seen
and active read time, but not enough to answer that: no like (removed in #142), no
dislike, no record of how much of a video was watched, and dwell was only measured while
the fast-scroll check-in was on (#6).

What changed:

- **Like and dislike are back as signals, not as a feature.** Double-tap any card or
  playing video to like it (again to undo); Like and "Didn't like this one" in the ···
  sheet and the reader. A liked card shows a small heart; nothing else appears. This
  reverses the part of #142 that removed likes; it keeps the part that matters - no
  Favorites collection, no new chrome on unliked cards. A dislike changes nothing but
  the record.
- **Every view is recorded** (`item_views`): time on screen in the foreground, opened,
  reading/playing time, video length, furthest point, plays, pauses, seeks, resumed,
  finished, scroll depth, and an instant-skip flag (under a second, not opened). Each
  row and each signal snapshots the item's source and tags (RSS categories plus
  #hashtags from the title), so the history survives archiving or removing a source.
  This is recorded regardless of the fast-scroll setting, which answers #6.
- **Engagement page and API.** `GET /engagement?by=source|tag&days=N` (and the agent
  route `/agent/engagement`) roll it up per channel or tag, with shares (#195) and saves
  joined in. The Engagement page under You lists it, sorted by most shown, most skipped
  or most liked, each channel linking to its source page.

Why it is shaped this way: the session engine stays untouched. These are descriptive
records Fisher reads; any use of them to re-weight sources is #21 / #24, after a month
of data, and has to be an explicit choice. A player's reported length also fills in
`duration_sec` where ingest and enrichment never found one.
