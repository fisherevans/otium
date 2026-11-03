# Centred cards with Shorts on, platform marks, and posts that read as posts

Fisher started an Everything mix and found three things wrong with the card (#205):
articles had moved to the top of the screen, he could not tell a Bluesky post from an
RSS article, and a Bluesky post was rendered as a headline truncated after a paragraph.

**Centring.** Two causes, both in how the solver's centring pad reaches the card. The
full-screen Shorts rule (#184) set `padding-top: var(--imm-top)` on every non-Short card,
replacing the rule that adds `--card-center-pad`, so in any session with Shorts every
article, post and long video sat directly under the header. Separately,
`solveWhenReady` waited for every image with `naturalHeight === 0`, which includes a hero
that has already failed to load; its events had fired, so the card was never solved at
all, in either mode. Now the full-screen rule adds the pad, the solver holds back the
card's own bottom padding (full screen's clearance for the floating chrome) as well as
`bottomGap` when it centres, broken images do not block the solve, a slow image blocks
it for at most 1.5s, and a hero its host refuses is dropped instead of leaving a frame.
Shorts mode still changes only short-video cards.

**Platform marks.** Items carry `source_kind` from their source, joined at read time on
every item query (session, reader, history, collections, source and topic lists). A
`PlatformMark` sits beside the source name on the card, the Shorts bar, the reader,
Details and History: lucide's RSS and podcast glyphs, and small inline marks for
YouTube, Bluesky, Substack and Medium, which lucide does not ship. They are monochrome
and take the meta text's colour, so they identify without competing.

**Posts.** The server now marks a Bluesky item `post: true` (`store.PostKinds`, which the
mix's Posts format also uses) and sends its whole `text`, rebuilt from the stored body
(paragraph breaks kept) or from the title and summary ingest split it into. The client
renders a post as author, then text at the reader's size; no headline, no excerpt. The
solver's post give order steps the picture down and drops replies before it trims the
text, and it trims to exactly what fits. Only a real attached image or link-card picture
is media; a link card whose picture is a profile avatar shows none. The reader opens a
post on its author and text with no headline, and History, Details, the session review
and the Discord sheet (and the Discord message title) name a post by its text, clipped
at a word, via `headline()` / `Item.Headline`.

**Gates.** `measure` now fails a card more than 4px off centre, net of the chrome it is
padded clear of, and a post showing its author's avatar as hero; it gained
`--immersive` (lab) and `--viewing on|off` (app). The lab has a full-screen knob and
four new fixtures. Three verify scripts had gone stale since #191/#195/#200/#203
(unmocked `/presets`, `/share/status` and conversation requests, and a button count that
included the sound hint); they are updated, and `useShareAvailable` no longer throws on a
204. The Shorts Details control, icon-only since #186, is back to a 44px target.

Issue: #205.
