# Send on Discord

Fisher wanted to send a video or article to a friend without leaving Otium, and to
post into a Discord channel, with a playable video or a normal link preview on the
other end (#195). Friends should not need an Otium account.

A friend is added by a nickname only Fisher sees. Otium mints a one-time connect link
(a week, single use). The friend opens it, approves the Otium Discord app, and is
added to Fisher's D.M.S. server. That is required, not decoration: Discord only lets a
bot DM someone it shares a server with, and `guilds.join` is what puts them there.
Channels are picked from the servers the bot has been added to.

Sending goes through a plain REST client (`internal/server/discord`), no gateway. The
message carries the raw URL in its content so Discord's own unfurler does the
rendering; a bot-built embed with a video field does not play inline. YouTube Shorts
links are rewritten to `watch?v=` for the same reason. Each target succeeds or fails
on its own, and a target whose last send failed is marked so in the picker and the
Sharing screen instead of failing silently.

Friends see everything sent to them at `share.fisher.sh/s/`, after a Discord sign-in.
History is grouped into streams by recipient set: things sent to one person, and things
sent to that person together with others, are separate streams. Co-recipients are named
by their Discord display name, never by Fisher's nicknames. There is no reply or comment
path; it is a one-way record. The `/s/*` routes are the only otium routes outside the
owner's login and read nothing but share history.

Shares copy the item's URL, title and thumbnail, so a friend's history survives the
item being archived. A share logs a `share` event, which is not a ranking signal.
