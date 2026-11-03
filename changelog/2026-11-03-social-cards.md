# Social cards carry the post; short Substack posts are posts; the conversation keeps going

**Date:** 2026-11-03
**Type:** feature
**Author:** claude-code

## What changed

Three changes from Fisher's #209 review of Bluesky, Substack and Medium in a session.

**The Bluesky card is the post.** On the session card a Bluesky post now shows its
text (links live), an attached picture or video poster, its replies/reposts/likes row,
and one or two top replies when there is room. The link card and the quoted post moved
to the reader. A post that is only a link (no text, no picture) shows the link's title
as one quiet line, not a card. The solver gives way in Fisher's order: the second reply,
then the first, then the picture steps down (34%, 26%, 18% of the screen), then the text
is trimmed. The link-description and quote knobs are gone with the things they trimmed.

**Short Substack and Medium posts render as posts.** "Some Substack posts act more like
Twitter posts these days and some are articles." The server decides which, on ingest
(`internal/server/shortform`): a post is short when its body has under 250 words, at
most one picture, and nothing a post cannot draw (embedded video or audio, tweets,
embedded posts, tables, code). A short one is stored as a structured post in
`items.post_json` with its title, and the client gets `post: true` and `post_body`
exactly as it does for Bluesky - nothing is guessed in the client. `items.form` records
`post` or `article`; the feed re-classifies on every fetch, and items stored before this
(and no longer in their feed) are classified once at boot (`Ingester.BackfillForms`).
A short post's card is the same post card with the platform's own mark (Substack orange,
Medium ink), the author, the publication under it, its title, text, picture, counts and
top comments. A long one keeps its article card - headline, hero, excerpt - plus a
counts row (from the counts stored at fetch, so it shows before the conversation
arrives) and its most-liked comment when there is room. Medium reports no counts, so
there is no row rather than a row of zeros. In a mix, a short Substack or Medium post
counts as a Post, not an Article (`session.FormatOf`).

**The reader's conversation keeps going.** Replies, quotes and reposts page as you
scroll (`GET /items/{id}/conversation/more?kind=replies|quotes|reposts&cursor=` and
`kind=thread&id=` for the replies under one reply). Bluesky's getPostThread and
Substack's comments endpoint both send every top-level reply in one answer, so replies
are paged on the server over the cached full conversation (20 at a time, an offset
cursor; the client drops any it already has). A page carries three levels, six replies
under each top-level reply and three below that; a reply cut there, or at Bluesky's
fetch depth, shows "Show N more replies", which fetches its subtree (a fresh
getPostThread rooted at it, or the cached Substack tree). Quotes page with getQuotes's
cursor and reposts with app.bsky.feed.getRepostedBy, shown as a quiet wrapping list of
names under "Reposted by". Every page is cached server-side for the conversation's TTL,
failures for a minute. In the reader an IntersectionObserver asks for the next page as
the end comes within about a screen; while a page is on its way there is a "Loading
more…" line, a failure says "Couldn't load more · Retry" (never a spinner), and the end
says "End of the conversation". Below three levels the indent stops growing.

## Why

Fisher: "On the scrolling page I care about just the primary text, post engagement
metrics, and maybe one or two key replies or comments (if there's room and there's
something there). When I read the posts, for many posts there's not much additional
detail. I'm curious if maybe we can load additional comments or replies or retweets or
something to scroll through as well."

## The short-form threshold, and the evidence

Sampled on 2026-11-03: 514 feed entries from 24 Substack publications and 6 Medium
accounts (Krugman, Slow Boring, Astral Codex Ten, Noahpinion, HCR, Gary Marcus, Robert
Reich, Silver Bulletin, One Useful Thing, Simon Willison, Lenny's, Persuasion, Steady,
Joyce Vance, Understanding AI, The Zvi, Experimental History and others; Ev Williams,
Netflix Tech Blog, The Atlantic on Medium and others). Lengths came from Substack's
`/api/v1/archive` `wordcount` where it had them, because a paid post's feed entry is a
preview: Slow Boring's "Make housing affordable again" is 28 words in the feed and 1,693
in the archive. The archive is now read before classifying (it was already fetched for
counts).

| words | entries |
|---|---|
| under 100 | 46 |
| 100-199 | 20 |
| 200-249 | 6 |
| 250-299 | 13 |
| 300-399 | 24 |
| 400-999 | 66 |
| 1,000+ | 339 |

The entries that read as posts - Krugman's one-chart travel-day post (50 words), ACX
open threads (85-188), a meetup notice (202), Slow Boring's photo-only discussion
threads, Ev Williams's short poems - all came in under ~200 words. The shortest essays
start around 300 (Gary Marcus's "BREAKING" posts, Steady's music posts, Joyce Vance's
"What in the World?" at 261). 250 splits the thin 200-300 band, and is about one phone
screen of text at reading size, so a post under it shows whole instead of being trimmed
like an article. For contrast, VTDigger's RSS articles in Fisher's library have a 10th
percentile of 357 words and a median of 729 (RSS sources are never classified; this is
only a sanity check that real news articles sit well above the line).

The rest of the rule came from the same sample: 113 entries were previews (Substack's
trailing "Read more", Medium's "Continue reading" snippet). A preview is only a post when
the archive confirms the feed has nearly all of it; a preview of unknown length stays an
article. Substack podcast and video posts (HCR's "To read this letter, click here" stubs
are 25-word podcast posts) stay articles, since their media is not in the body. A wrong
"post" loses content on the card; a wrong "article" only looks heavier, so every unclear
case falls to article. Fixtures in `internal/server/shortform/testdata` are real sampled
bodies, trimmed of Substack's inline icons.

## Decisions

- The video poster stays on a Bluesky card with the picture: it is the post's own media.
- A short post's title is kept as a line above its text (Substack posts have one; it is
  what History, Details and Discord name it by).
- Reposts load last (after every reply and quote page) and only in the reader.
- The pull to the next item waits while more of the conversation is loading or still to
  load (`ReaderPage` `atBottom`), and the "Swipe up for the next item" cue and the
  instrument's "End of post" appear only once it has ended. After a failed page the
  pull is allowed again, since nothing more will load without a tap.

Issue: #209.
