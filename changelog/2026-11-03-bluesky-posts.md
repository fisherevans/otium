# Bluesky posts look like Bluesky posts

Fisher, on an On the Media post (#207): it did not read as Bluesky, its shortened link
(`lnk.to/onthemedia/b...`) was dead text, the reader opened on the show's link-tree
description as if it were the content, and the likes and reposts he saw on the card were
buried below the post in the reader. Articles look like articles and long videos like
embedded videos; a text post should look like a post.

**Storage: a structured post.** Ingest now stores what the client renders as JSON in
`items.post_json` (`richtext.Post`): the author (name, handle, avatar, profile), the text
as segments, the images (with aspect), a link card `{uri, title, description, thumb,
domain}`, a video poster and the quoted post. Items send it as `post_body`. The title,
summary, `text` and HTML body are still derived from it, so lists, Discord and History
keep working, and the HTML body now carries the links too. Chosen over facet-linked
HTML because the card needs the parts separately (the link card and quote are laid out
and trimmed by the solver, not printed as paragraphs).

**Facets.** `internal/server/richtext` applies Bluesky's rich-text facets on the server,
where the text is still bytes: facets index UTF-8 byte offsets, not characters (the On
the Media post has a curly apostrophe three bytes wide before its link). The client gets
ordered segments, plain or `{kind, href}`; joined, they are the text exactly. Links go to
the facet's real URI, mentions to `bsky.app/profile/<did>`, hashtags to
`bsky.app/hashtag/<tag>`. Out-of-range, empty, overlapping and mid-character ranges and
non-http(s) links are ignored, never fatal. Replies and quotes in the conversation
carry segments too, and replies now nest three levels (`getPostThread` depth 3, six
children per reply, most-liked first at every level).

**Existing posts.** `UpsertItem` now rewrites a post's body and derived columns whenever
its fetched `post_json` differs from what is stored, so every post in an account's last
50 picks up the new shape on the next fetch of its source - no backfill job. Older posts
render through the same component from their text and picture
(`lib/posts.ts postBody`).

**The card.** A post is its own card: avatar, name, time and @handle, the Bluesky
butterfly in Bluesky blue; the text with live links; pictures (one at its shape, two side
by side, three or four in a grid, read from the top when capped); a compact link card
(thumbnail, title, two-line description, domain; the whole card is the link); a quoted
post inset; then replies, reposts and likes. Its top replies hang off it on a thread
line, with "N more replies" into the reader. The solver's give order for a post is now:
picture steps, second reply, picture to 18%, both replies, the link card's description,
a quoted post down to two lines, and only then the text (a quoted post's text goes
entirely as the very last resort, which a 320px quote post needed). The primary action reads "View post".

**The reader.** The same post card at the top, with its engagement row directly under it,
then every reply threaded (replies to replies indented on a line), then quotes, then
"Open on Bluesky". No About block, no headline, no separate meta line.

Substack posts and articles are unchanged. Lab fixtures `bsky-otm`, `bsky-images`,
`bsky-quoted` and `bsky-thread` cover the shapes; `measure` also fails a post link without
an http(s) target and a link card taller than 130px.

Issue: #207.
