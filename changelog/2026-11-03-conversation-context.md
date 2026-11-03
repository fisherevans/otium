# Replies, quotes and comments on posts and videos

A Bluesky post, a Substack essay or a YouTube video read differently once you see how
people answered it, and until now Otium showed the post alone (#200). Fisher chose
"Option A" in the 2026-11-03 review: the conversation sits on the card, small, with the
rest one tap away.

**What shows where.** A social post's card gets a counts line (likes, reposts or
restacks, replies, quotes), the post it quotes as an inset, its two most-liked replies
(author, like count, three lines of text), and "N more replies and M quotes", which opens
the reader. The reader puts the whole conversation under the post: replies most-liked
first, then quotes, then "Open on Bluesky" (or Substack). A landscape long video gets its
top comments under the player, and the rest open in an overlay. Shorts get a comments
control in their footer that opens the same overlay - the card has no room, and Fisher
asked for the overlay specifically. Playback pauses behind it, like every other sheet.

**Platforms.** Bluesky replies come from `app.bsky.feed.getPostThread` (depth 1) and
quotes from `app.bsky.feed.getQuotes`, both on the public AppView with no login.
Substack comments come from the publication's undocumented but stable
`/api/v1/posts/<slug>` (for the post id and counts) and `/api/v1/post/<id>/comments`.
YouTube uses `commentThreads.list` plus `videos.list` for the counts - one quota unit
each - and only when the Data API key is configured. Medium exposes nothing.

**Fetched on demand, never in the way.** `GET /api/v1/items/{id}/conversation` asks the
platform when a card is focused (and for the next card, ahead of time), and caches the
answer in server memory for ten minutes - counts change, so it is not stored with the
item. A failure is cached for a minute and the card simply shows no conversation; 204
means the item has none. The card never waits for it: it renders, then the replies join
and the layout is solved again.

**Layout.** The card's height is solved at runtime (`lib/cardLayout.ts`), so the replies
are part of the solver's give order rather than a fixed block: the second reply goes
after the title has stepped down to 19px, then both replies, and only then the excerpt -
the post's own text matters more than the answers to it. The "more" link always stays.
On a video card, comments are never allowed to shrink the player below its natural
size; they go first. Layout lab fixtures cover each shape (`bsky-quote`, `bsky-image`,
`substack-comments`, `video-wide-comments`).

**Safety.** All remote text is plain text, rendered as React text, never as HTML; links
are only the platform URLs the server builds.
