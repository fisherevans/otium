# Tumblr blogs as a source

Tumblr is now a source kind (#216). The first one is scootyin2d, an indie game dev who
posts devlog clips and pixel art.

**Why RSS and not the API.** Every blog serves `https://<blog>.tumblr.com/rss` with no
auth: the last 20 posts, each with its whole body as HTML, plus tags as `<category>`. The
v2 API would give structured posts (NPF) and let us filter out reblogs, but it needs a
registered app key. The feed already carries everything a card needs, so there's no key
to manage. If reblog noise becomes a problem, the API is the next step.

**What changed.**

- **Adding one.** The add-source wizard has a Tumblr entry. `social.TumblrHost` accepts a
  blog name, `@name`, `name.tumblr.com`, `tumblr.com/name`, `tumblr.com/blog/view/name`, a
  post link in either URL form, or a custom domain. The avatar is the API's public
  `/avatar/128` endpoint, which needs no key.
- **Posts, not articles.** `shortform.Tumblr` reads the feed's shapes:
  - pictures in `figure.tmblr-full`, with their aspect from `data-orig-*`
  - Tumblr-hosted video from a figure's `data-npf` JSON (the 720p MP4 and its poster)
  - link blocks (`p.npf_link`) as the link card
  - a reblog (`a.tumblr_blog` + blockquote) as the quoted post, with that blog's avatar

  Unlike Substack, a photoset is still a post. It stays an article only past 250 words, or
  when it embeds something a post can't draw (a YouTube iframe, an audio player). Tumblr's
  "ALT" badge is skipped as platform furniture.
- **MP4 plays in place everywhere.** `richtext.Video` gets `file`, a plain MP4.
  `VideoPoster` plays it inline on any browser. HLS `playlist` (Bluesky) still needs Safari.
- **No counts row.** The feed has no notes or likes.
- **Titles.** Tumblr escapes its titles and descriptions twice (`i&amp;rsquo;ve`), and
  gofeed only undoes one layer, so ingest unescapes the second.

**Fix along the way.** The shortform walker returned `"segments": null` for a post with no
text, and `PostCard` crashed mapping over it. A reblog of a video with no comment hit
this; a picture-only Substack post could have too. It now always returns a list.

**Follow-up (v0.102.1).** The agent API could only add a source as a trial, so a blog
Fisher asked an agent to follow landed as a trial that needed a tap on Keep. Agents now
have the same verb as Keep: `POST /agent/sources/{id}/follow`. `POST /agent/suggestions`
also takes `follow: true` to add a source as followed in one call, for when the owner asked
for it; recommender proposals still go in as `trial`.
