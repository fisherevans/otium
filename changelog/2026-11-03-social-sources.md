# Bluesky, Substack and Medium sources, and a Most popular order

Fisher wanted the places he actually reads - Substack newsletters, Medium writers and
Bluesky accounts - as sources, and a way to handle accounts that post many small
things a day without a session turning into that account's last hour (#197).

**Bluesky** is a native source kind on the public AppView API, no login. The source's
`feed_url` is `bsky:<did>`, a marker the ingester recognises rather than a URL it
fetches. Only the account's own posts come in; reposts and replies are skipped. A post
has no headline, so its first line is the title and the rest is the summary (a
one-line post is not printed twice). Images and link cards go into the reader body, the
first one becomes the card image.

**Substack** stays RSS for content and adds the publication's `/api/v1/archive` for
reaction, restack and comment counts, matched to items by canonical URL. **Medium** is
RSS only; it exposes no counts. All three are resolved on the server from what a person
pastes (a handle, a profile link, a publication name), with a preview in the wizard.

**Most popular** is a new per-source article order. It scores each eligible post by
engagement velocity, `(likes + 2*reposts + replies + 1) / (age_hours + 2)^1.5` - the
Hacker News shape, gentler gravity - normalized to the source's best post and floored at
0.05 so nothing eligible is dropped. It decays with age on its own, so it replaces
"newest first" instead of multiplying with it. Fisher chose platform popularity over his
own engagement: his own signals (#196) only exist for posts he has already seen, so they
cannot rank unseen ones. It is offered only for kinds that report counts.

A new Bluesky source starts on Most popular with a 3-day archive window: the best of the
last few days, not the latest few posts. Twitter/X is not supported - no free API and the
RSS bridges are gone - and is tracked separately.
