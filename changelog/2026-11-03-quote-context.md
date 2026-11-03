# Posts carry what they quote, link to and play

**Date:** 2026-11-03
**Type:** feature
**Author:** claude-code

## What changed

- **The quoted post is on the card again, and complete.** It is drawn the way an
  embedded post, a shared tweet or a screenshot draws one: inset, with the quoted
  author's avatar, name, handle and time, its text, and its own pictures, video poster
  or link card. Before, the card dropped it entirely and the reader reduced its picture
  to the word "Image". A quote inside the quote is named on one line ("Quoting Rae"),
  as Bluesky does. A quoted post that cannot be shown (deleted, blocked, detached by
  its author) says so instead of vanishing, and a shared feed, list or starter pack is
  a small card.
- **The link card is on the card again.** Large (picture across the top, title,
  description, domain) when it is the post's only attachment, as Bluesky and X draw
  it; compact beside pictures or a quote.
- **Replies show what they carry.** A reply's pictures render as pictures (a strip of
  thumbnails on the card, a small grid in the reader), with its link card, video and
  quoted post in the reader.
- **Bluesky videos play in place.** The server keeps the video's HLS playlist; a tap
  on the poster plays it on the card or in the reader where the browser plays HLS
  (Safari on iPhone does natively), with the native controls. Elsewhere the tap opens
  the post on Bluesky. It pauses when it scrolls away and never starts on its own.
- **Solver.** The card gives way in this order: second reply, first reply, picture to
  34% then 26%, large link card to compact, the quote's pictures to a strip, picture to
  18%, the quote's text to two lines, and only then the post's own text. Because the
  knobs only move forward, the replies are given back afterwards when a late step
  freed enough room.

## Why

Fisher, on a 404 Media post that read "see these are amazing" with nothing under it:
"It means nothing without what it's actually quoting." #209 had moved the quote and
link card to the reader to keep the card to text, counts and replies; that was wrong
for posts whose text is a comment on something else. In 404 Media's last 50 posts, 31
share a link and 7 quote a post, so most of a news account's posts depend on their
attachment. He also asked to play a post's video without leaving for Bluesky.

## Decisions

- Context outranks replies: replies give way before the quote or link card shrink.
- On the card a tap on the quote opens the reader (the quote is not its own link
  there); in the reader the whole quote opens the quoted post.
- Stored posts are re-shaped on every fetch (#207), so existing items pick up the
  richer quote on the next ingest; until then the reader fills it from the
  conversation's `quoted`.
- Inline playback was checked against real data only as far as headless Chromium
  allows (it does not play HLS, so it shows the link-out fallback); the iPhone path
  is the native `<video>` with Bluesky's playlist.

Issue: #210.

## Follow-up: no "Reposted by" list (v0.98.1)

The reader no longer pages or shows who reposted a post. Fisher: "I do not care to see
the list of people who reposted it." A list of names says nothing about the post, and
loading it held the pull-to-next until it ended. The server no longer advertises a
reposts cursor; the repost count stays in the counts row.
