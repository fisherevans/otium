import type { Conversation, ConversationComment, Item, Selected } from "@/api/client";

// Fixtures for the layout lab (/lab). These are real `Selected` payloads - the
// same shape the session endpoint returns - so SessionCard renders them exactly
// as it renders live items. They cover the content shapes that actually break
// layouts: long headlines, portrait heroes, 9:16 video, missing metadata,
// unbroken source names and non-Latin titles.
//
// Images are inline SVG data URIs so the lab is self-contained and deterministic:
// no network, no cache, identical pixels on every run.

function pic(w: number, h: number, tone: "light" | "dark" = "light"): string {
  const bg = tone === "light" ? "#d9d4c6" : "#8d887c";
  const fg = tone === "light" ? "#f2efe6" : "#e6e2d6";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${bg}"/>` +
    `<circle cx="${w * 0.5}" cy="${h * 0.38}" r="${Math.min(w, h) * 0.22}" fill="${fg}"/>` +
    `<rect x="0" y="${h * 0.72}" width="${w}" height="${h * 0.28}" fill="${fg}" opacity="0.35"/>` +
    `<text x="${w / 2}" y="${h - 10}" font-family="monospace" font-size="${Math.max(10, w * 0.045)}" ` +
    `fill="#3a362e" text-anchor="middle">${w}×${h}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// A profile picture: what a Bluesky author has instead of a hero (#205). Square,
// so a card that wrongly promoted it to the hero would show it unmistakably.
const AVATAR = pic(400, 400, "dark");

const NOW = "2026-08-16T12:00:00Z";

const OTM_TEXT =
  "Struggling to figure out if an election story is true or false? Check out the election rumor rundown from the Center for an Informed Public and listen to our conversation with co-founder @katestarbird.bsky.social on this week\u2019s show. lnk.to/onthemedia/b...";
function ago(days: number): string {
  return new Date(Date.parse(NOW) - days * 86400_000).toISOString();
}

function item(over: Partial<Item>): Item {
  return {
    id: 1,
    source_kind: "rss",
    source_id: 1,
    url: "https://example.org/a",
    title: "",
    summary: "",
    content: "",
    content_source: "rss",
    author: "",
    thumbnail_url: "",
    media_type: "article",
    duration_sec: 0,
    aspect_ratio: 0,
    published_at: ago(2),
    fetched_at: NOW,
    ...over,
  };
}

function sel(over: Partial<Selected> & { item: Item }): Selected {
  return {
    source_title: "ProPublica",
    source_icon_url: "",
    topic: { name: "Investigations", slug: "investigations", color: "#5f6f8f", icon: "search" },
    score: 0.9,
    est_duration_sec: 240,
    reason: "Recent",
    breakdown: { weight: 1, rarity: 1, freshness: 0.9, effective_score: 0.9, cadence_per_day: 0.6, age_days: 2 },
    ...over,
  };
}

export interface Fixture {
  key: string;
  label: string;
  /** Section the topic belongs to. Not in the session payload yet - see SessionCard. */
  section?: string;
  /** What this case is here to stress. */
  note: string;
  sel: Selected;
  /** #200: the conversation the card shows. Omitted = none (the lab never fetches). */
  conversation?: Conversation;
}

export const FIXTURES: Fixture[] = [
  {
    key: "news-portrait",
    section: "General News",
    label: "Article · 4:5 hero · long headline",
    note: "The case that truncates today and crops a portrait photo to a band.",
    sel: sel({
      item: item({
        id: 1,
        source_kind: "rss",
        title:
          "Wall Street's Nonprofits Use Selective, Opaque Logic to Decide Which Charities Get Defunded, and They Won't Say Why",
        author: "Ellis Simani",
        summary:
          "Donor-advised funds at the biggest brokerages have quietly built their own rules for which charities qualify, and the criteria are not published anywhere a grantee can read them.",
        content: "<p>body</p>",
        thumbnail_url: pic(600, 750),
      }),
    }),
  },
  {
    key: "news-wide",
    section: "General News",
    label: "Article · 16:9 hero",
    note: "The ordinary case. Whatever a variant does, it must not regress this.",
    sel: sel({
      item: item({
        id: 2,
        source_kind: "rss",
        title: "State Regulators Knew About the Culvert Backlog for Six Years",
        author: "Anne Wallace Allen",
        summary:
          "Internal memos show the agency flagged the problem in 2020 and again in 2022, then removed the line item from its own budget request twice.",
        content: "<p>body</p>",
        thumbnail_url: pic(1280, 720),
        published_at: ago(5),
      }),
      reason: "From ProPublica",
    }),
  },
  {
    key: "news-bare",
    section: "General News",
    label: "Article · no hero · short headline",
    note: "The light payload. The only shape that survives every viewport today.",
    sel: sel({
      item: item({
        id: 3,
        source_kind: "rss",
        title: "A Short One",
        author: "Ash Ngu",
        summary: "Brief item, small summary, to see how the card handles a light payload.",
        content: "<p>body</p>",
        published_at: ago(0),
      }),
      reason: "Fresh - posted today",
    }),
  },
  {
    key: "video-vertical",
    section: "Music Production",
    label: "Video · 9:16 portrait",
    note: "Actions fall outside the card at 412px and below. Wants maximum frame.",
    sel: sel({
      item: item({
        id: 4,
        source_kind: "youtube",
        title: "Ukulele that transforms into a guitar mid-song",
        media_type: "short",
        aspect_ratio: 9 / 16,
        duration_sec: 47,
        author: "Mattias Krantz",
        summary: "A short build log for the neck-swap mechanism.",
        thumbnail_url: pic(720, 1280, "dark"),
        url: "https://www.youtube.com/shorts/aaaaaaaaaaa",
        published_at: ago(4),
      }),
      source_title: "Mattias Krantz",
      topic: { name: "Finger Drumming", slug: "finger-drumming", color: "#7a6a4f", icon: "music" },
      reason: "From Mattias Krantz",
    }),
  },
  {
    key: "video-wide",
    section: "Music Production",
    label: "Video · 16:9 · long headline",
    note: "Width-bound media: lots of spare height, and a title that still truncates.",
    sel: sel({
      item: item({
        id: 5,
        source_kind: "youtube",
        title:
          "I built a drum machine out of a 1970s answering machine and it has a genuinely usable sixteen step sequencer",
        media_type: "long",
        aspect_ratio: 16 / 9,
        duration_sec: 862,
        author: "Mattias Krantz",
        summary: "A teardown, a rewire, and a surprisingly usable sixteen-step sequencer.",
        thumbnail_url: pic(1280, 720, "dark"),
        url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
        published_at: ago(6),
      }),
      source_title: "Mattias Krantz",
      topic: { name: "Finger Drumming", slug: "finger-drumming", color: "#7a6a4f", icon: "music" },
      reason: "From Mattias Krantz",
    }),
  },
  {
    key: "short-square",
    section: "Design",
    label: "Short video · square · long creator name",
    note: "A square Short stays uncropped, with a compact credit that cannot push Details off screen.",
    sel: sel({
      item: item({
        id: 11,
        source_kind: "youtube",
        title: "How one shape changes the whole composition",
        media_type: "short",
        aspect_ratio: 1,
        duration_sec: 150,
        summary: "A study of proportion, balance and negative space.",
        thumbnail_url: pic(720, 720, "dark"),
        url: "https://www.youtube.com/shorts/ccccccccccc",
      }),
      source_title: "ArchitecturalCompositionWithoutAnyBreaks",
    }),
  },
  {
    key: "short-wide",
    section: "Music Production",
    label: "Short video · landscape",
    note: "Otium includes short landscape videos. Shorts mode must preserve the full frame.",
    sel: sel({
      item: item({
        id: 12,
        source_kind: "youtube",
        title: "One melody, three instruments",
        media_type: "short",
        aspect_ratio: 16 / 9,
        duration_sec: 60,
        summary: "A short arrangement played on three different instruments.",
        thumbnail_url: pic(1280, 720, "dark"),
        url: "https://www.youtube.com/watch?v=ddddddddddd",
      }),
      source_title: "Sound Workshop",
    }),
  },
  {
    key: "long-vertical",
    section: "Design",
    label: "Long video · portrait",
    note: "Portrait geometry alone must not opt a long video into Shorts mode.",
    sel: sel({
      item: item({
        id: 13,
        source_kind: "youtube",
        title: "Building the complete sculpture from a single sheet of paper",
        media_type: "long",
        aspect_ratio: 9 / 16,
        duration_sec: 720,
        summary: "The full process, from the first fold to the finished piece.",
        thumbnail_url: pic(720, 1280, "dark"),
        url: "https://www.youtube.com/watch?v=eeeeeeeeeee",
      }),
      source_title: "Paper Workshop",
    }),
  },
  {
    key: "audio",
    section: "Long Form",
    label: "Podcast · audio",
    note: "No frame, a waveform, and its own action row. Title is clamped to 2 today.",
    sel: sel({
      item: item({
        id: 6,
        source_kind: "podcast",
        title: "Episode 214: The people who maintain the machines nobody remembers buying",
        media_type: "audio",
        duration_sec: 3120,
        author: "",
        summary: "A conversation about long-lived infrastructure and the folks who keep it running.",
        thumbnail_url: pic(600, 600),
        published_at: ago(3),
      }),
      source_title: "Maintenance Phase Adjacent",
      topic: { name: "Long Listens", slug: "long-listens", color: "#6a5f7a", icon: "mic" },
    }),
  },
  {
    key: "no-meta",
    section: "",
    label: "Article · no author, no topic",
    note: "Topicless source: the source name leads. Byline collapses to a date.",
    sel: sel({
      item: item({
        id: 7,
        source_kind: "rss",
        title: "Notes from a week of watching the river gauge",
        summary: "Short field notes, no byline, no topic assigned.",
        content: "<p>body</p>",
        thumbnail_url: pic(1280, 720),
      }),
      topic: null,
      source_title: "Riverbank",
      reason: "",
    }),
  },
  {
    key: "link-only",
    section: "General News",
    label: "Article · summary only, no full text",
    note: "No extractable body, so no in-app read. The row loses its solid button.",
    sel: sel({
      item: item({
        id: 10,
        source_kind: "medium",
        // resolved external: there is a teaser but no body to open in-app
        content_source: "external",
        title: "Council votes to fund the culvert survey after all",
        author: "Anne Wallace Allen",
        summary:
          "A one-paragraph wire item with no body text to extract, which is most of what an RSS feed actually carries.",
        thumbnail_url: pic(1280, 720),
        published_at: ago(1),
      }),
      reason: "From ProPublica",
    }),
  },
  {
    key: "unbroken",
    section: "Verkehr",
    label: "Stress · unbroken names",
    note: "A source and topic with no break opportunity. Tests overflow, not taste.",
    sel: sel({
      item: item({
        id: 8,
        source_kind: "rss",
        title: "Supercalifragilisticexpialidocious infrastructure maintenance considerations",
        author: "A Verylongsurnamewithoutspaces",
        summary: "Testing wrap behaviour with unbreakable tokens in every metadata slot.",
        content: "<p>body</p>",
        thumbnail_url: pic(1280, 720),
      }),
      source_title: "Bundesnachrichtendienstnachrichten",
      topic: { name: "Verkehrsinfrastrukturplanung", slug: "v", color: "#5f8f7a", icon: "" },
    }),
  },
  {
    key: "cjk",
    section: "調査",
    label: "Stress · Japanese headline",
    note: "Different line-breaking and glyph height. Type ramps must still be legible.",
    sel: sel({
      item: item({
        id: 9,
        source_kind: "rss",
        title: "国土交通省は老朽化した橋梁の点検記録を六年間にわたり公表していなかったことが明らかになった",
        author: "編集部",
        summary: "点検記録の非公表について、担当者は「様式が統一されていなかった」と説明している。",
        content: "<p>body</p>",
        thumbnail_url: pic(600, 750),
      }),
      source_title: "調査報道センター",
      topic: { name: "調査報道", slug: "cjk", color: "#8f5f5f", icon: "" },
    }),
  },
  // #200: conversation fixtures. Replies are long on purpose: the card clamps
  // each to three lines and the solver gives them up before the excerpt.
  {
    key: "bsky-quote",
    section: "Tech",
    label: "Bluesky post · quote inset · two replies",
    note: "A text post that quotes another, with counts, its top replies and the rest one tap away.",
    sel: sel({
      item: item({
        id: 20,
        source_kind: "bluesky",
        post: true,
        text: "This is the most honest release note I have read all year.\nThey reverted ten features rather than ship something reviewers could not keep up with. More projects should be willing to say that out loud.",
        url: "https://bsky.app/profile/someone.bsky.social/post/3abc",
        title: "This is the most honest release note I have read all year.",
        summary: "They reverted ten features rather than ship something reviewers could not keep up with. More projects should be willing to say that out loud.",
        content: "<p>body</p>",
        author: "Kelsey Ortiz",
        published_at: ago(0.3),
      }),
      source_title: "Kelsey Ortiz",
      source_icon_url: AVATAR,
      topic: { name: "Databases", slug: "db", color: "#5f6f8f", icon: "" },
    }),
    conversation: conv("bluesky", { likes: 183, reposts: 11, replies: 14, quotes: 3 }, [
      reply("Dana Whitfield", 41, "The bit about reviewers finding more than humans can fix is the real story here. That is a capacity problem, not a tooling one, and it will hit every big project soon."),
      reply("mit1975eecs", 12, "It exposes the mindset of the developers. Move fast and break things versus write it once and keep it running for twenty years."),
      reply("a bezoar", 2, "Link for anyone who missed it."),
    ], reply("The Register", 0, "Postgres 19 delayed after AI reviewers find more bugs than humans can fix. Core devs revert up to 10 features and push the release to November.", "link")),
  },
  {
    key: "bsky-image",
    section: "Tech",
    label: "Bluesky post · image · replies",
    note: "A post whose image competes with its replies for height.",
    sel: sel({
      item: item({
        id: 21,
        source_kind: "bluesky",
        post: true,
        text: "Found the original wiring diagram for the building, hand drawn in 1931.\nEvery circuit labelled in the same careful hand. Somebody spent weeks on this.",
        url: "https://bsky.app/profile/someone.bsky.social/post/3abd",
        title: "Found the original wiring diagram for the building, hand drawn in 1931.",
        summary: "Every circuit labelled in the same careful hand. Somebody spent weeks on this.",
        content: "<p>body</p>",
        thumbnail_url: pic(1200, 900),
        author: "Sam Reyes",
        published_at: ago(1),
      }),
      source_title: "Sam Reyes",
      source_icon_url: AVATAR,
      topic: { name: "Old Things", slug: "old", color: "#7a6a4f", icon: "" },
    }),
    conversation: conv("bluesky", { likes: 2400, reposts: 310, replies: 96, quotes: 22 }, [
      reply("Ruth Allen", 380, "The lettering on the panel schedule is gorgeous. Draftsmen used to train for years to letter like that and it shows in every label on the sheet."),
      reply("Theo", 122, "Please scan it at high resolution before anything happens to it. Archives would love this."),
    ]),
  },
  {
    key: "news-vtdigger",
    section: "News",
    label: "Article · 3:2 hero · centred in full screen",
    note: "Fisher's #205 case: a short local-news card in a session with Shorts. It must centre whether full-screen Shorts is on or off.",
    sel: sel({
      item: item({
        id: 30,
        source_kind: "rss",
        url: "https://vtdigger.org/2026/11/02/gifford-health-care-daycare/",
        title: "Gifford Health Care raises rates and reduces hours on its employee daycare center",
        summary: "\u201cWe're entering a period of hard trade-offs in healthcare, and this is one of them,\u201d the hospital said.",
        content: "<p>body</p>",
        thumbnail_url: pic(1200, 800),
        published_at: ago(0.6),
      }),
      source_title: "VTDigger",
      topic: { name: "Local News", slug: "local-news", color: "#5f6f8f", icon: "" },
    }),
  },
  {
    key: "bsky-text-short",
    section: "Tech",
    label: "Bluesky post · one line, no media",
    note: "#205: a text post with nothing but its author's avatar. The text is the card, at reading size; the avatar stays in the credit.",
    sel: sel({
      item: item({
        id: 31,
        source_kind: "bluesky",
        post: true,
        url: "https://bsky.app/profile/someone.bsky.social/post/3abe",
        title: "have reached the point where >50% of my email inbox is ai spam",
        text: "have reached the point where >50% of my email inbox is ai spam",
        content: "<p>have reached the point where &gt;50% of my email inbox is ai spam</p>",
        published_at: ago(0.1),
      }),
      source_title: "Jason Koebler",
      source_icon_url: AVATAR,
      topic: { name: "Tech Press", slug: "tech-press", color: "#5f6f8f", icon: "" },
    }),
  },
  {
    key: "bsky-text-long",
    section: "Tech",
    label: "Bluesky post · 300 characters, line breaks, replies",
    note: "#205: a full-length post. It shows whole where it fits; the replies give way before the text is trimmed.",
    sel: sel({
      item: item({
        id: 32,
        source_kind: "bluesky",
        post: true,
        url: "https://bsky.app/profile/someone.bsky.social/post/3abf",
        title: "the idea of some random guy making his chatbot write a press release about how his chatbot is a bad employee then emailing it to a bunch of journalists is still cracking me up, it\u2019s so good. I really\u2026",
        text: "the idea of some random guy making his chatbot write a press release about how his chatbot is a bad employee then emailing it to a bunch of journalists is still cracking me up, it\u2019s so good. I really hope this becomes a genre.\n\nAnyway: if your chatbot has a complaint, the newsroom inbox is open.",
        content: "<p>body</p>",
        published_at: ago(0.4),
      }),
      source_title: "Jason Koebler",
      source_icon_url: AVATAR,
      topic: { name: "Tech Press", slug: "tech-press", color: "#5f6f8f", icon: "" },
    }),
    conversation: conv("bluesky", { likes: 110, reposts: 20, replies: 3, quotes: 0 }, [
      reply("Jason Koebler", 27, "and that it did this to an army veteran smgdh"),
      reply("Reader", 4, "Genuinely the best thing in my inbox this week, and I say that as someone who reads a lot of press releases."),
    ], reply("Jason Koebler", 0, "The wildest one of these I got was a three PDF \"press release\" rollout from someone who said his ChatGPT sometimes got something wrong and that this was a scandal.", "image")),
  },
  {
    key: "bsky-link-avatar",
    section: "Tech",
    label: "Bluesky post · link card whose picture is an avatar",
    note: "#205: a link card can carry the linked profile's avatar. That is identity, never a hero: the card shows the text alone.",
    sel: sel({
      item: item({
        id: 33,
        source_kind: "bluesky",
        post: true,
        url: "https://bsky.app/profile/someone.bsky.social/post/3abg",
        title: "Go follow my colleague, she has been on this story for a year.",
        text: "Go follow my colleague, she has been on this story for a year.",
        content: "<p>body</p>",
        thumbnail_url: "https://cdn.bsky.app/img/avatar/plain/did:plc:example/bafkexample",
        published_at: ago(0.8),
      }),
      source_title: "Maggie Harrison Dupr\u00e9",
      source_icon_url: AVATAR,
      topic: { name: "Tech Press", slug: "tech-press", color: "#5f6f8f", icon: "" },
    }),
  },
  // #207: posts with their structured body - links from facets, a compact link
  // card, pictures, a quoted post, and a thread deep enough to give way.
  {
    key: "bsky-otm",
    section: "News",
    label: "Bluesky post · mention + shortened link + link card",
    note: "#207, Fisher's On the Media post: the shortened lnk.to link and the mention must be live links. #209: the link card is the reader's; the card shows no link card.",
    sel: sel({
      item: item({
        id: 40,
        source_kind: "bluesky",
        post: true,
        url: "https://bsky.app/profile/onthemedia.bsky.social/post/3mzfxog3uyf23",
        title: "Struggling to figure out if an election story is true or false? Check out the election rumor rundown from the Center for an Informed Public and listen to our…",
        text: OTM_TEXT,
        content: "<p>body</p>",
        thumbnail_url: pic(400, 400),
        likes: 10,
        reposts: 5,
        replies: 0,
        published_at: ago(0.125),
        post_body: {
          author: { name: "On the Media", handle: "onthemedia.bsky.social", avatar: AVATAR, url: "https://bsky.app/profile/onthemedia.bsky.social" },
          segments: [
            { text: OTM_TEXT.slice(0, OTM_TEXT.indexOf("@")) },
            { text: "@katestarbird.bsky.social", kind: "mention", href: "https://bsky.app/profile/did:plc:h3t5rqlvuaorq42yckpijirj" },
            { text: " on this week\u2019s show. " },
            { text: "lnk.to/onthemedia/b...", kind: "link", href: "https://lnk.to/onthemedia/bluesky" },
          ],
          link: {
            uri: "https://lnk.to/onthemedia/bluesky",
            title: "On the Media",
            description: "The Peabody Award-winning On the Media podcast is your guide to examining how the media sausage is made. Hosts Brooke Gladstone and Micah Loewinger examine threats to free speech and government transparency.",
            thumb: pic(400, 400),
            domain: "lnk.to",
          },
        },
      }),
      source_title: "On the Media",
      source_icon_url: AVATAR,
      topic: { name: "Media", slug: "media", color: "#5f6f8f", icon: "" },
    }),
  },
  {
    key: "bsky-images",
    section: "Tech",
    label: "Bluesky post · two pictures · hashtag · replies",
    note: "#207: two pictures side by side under the solver's hero cap; the replies give way before the pictures shrink to their floor.",
    sel: sel({
      item: item({
        id: 41,
        source_kind: "bluesky",
        post: true,
        url: "https://bsky.app/profile/maggie.bsky.social/post/3img",
        title: "NEW: I talked to an epileptologist and surgeon who said the device is being marketed far past what the evidence supports.",
        text: "NEW: I talked to an epileptologist and surgeon who said the device is being marketed far past what the evidence supports. #health",
        content: "<p>body</p>",
        thumbnail_url: pic(1200, 900),
        likes: 68,
        reposts: 9,
        replies: 4,
        published_at: ago(0.5),
        post_body: {
          author: { name: "Maggie Harrison Dupr\u00e9", handle: "mharrisondupre.bsky.social", avatar: AVATAR },
          segments: [
            { text: "NEW: I talked to an epileptologist and surgeon who said the device is being marketed far past what the evidence supports. " },
            { text: "#health", kind: "tag", href: "https://bsky.app/hashtag/health" },
          ],
          images: [
            { thumb: pic(1200, 900), alt: "A device on a table", aspect: 1.333 },
            { thumb: pic(900, 1200, "dark"), alt: "A screenshot of an ad", aspect: 0.75 },
          ],
        },
      }),
      source_title: "Maggie Harrison Dupr\u00e9",
      source_icon_url: AVATAR,
      topic: { name: "Tech Press", slug: "tech-press", color: "#5f6f8f", icon: "" },
    }),
    conversation: conv("bluesky", { likes: 68, reposts: 7, replies: 4, quotes: 2 }, [
      reply("Ruth Allen", 12, "This is the part of the story that should worry regulators most: nobody is checking the claims after launch."),
      reply("Theo", 3, "Great reporting, thank you for doing this."),
    ]),
  },
  {
    key: "bsky-quoted",
    section: "Tech",
    label: "Bluesky post · quotes a post with a link card",
    note: "#207: the quoted post comes with the post. #209: it is shown in the reader only; the card is the text and its counts.",
    sel: sel({
      item: item({
        id: 42,
        source_kind: "bluesky",
        post: true,
        url: "https://bsky.app/profile/jason.bsky.social/post/3quo",
        title: "the idea of some random guy making his chatbot write a press release about how his chatbot is a bad employee",
        text: "the idea of some random guy making his chatbot write a press release about how his chatbot is a bad employee then emailing it to a bunch of journalists is still cracking me up",
        content: "<p>body</p>",
        likes: 110,
        reposts: 20,
        replies: 3,
        published_at: ago(0.4),
        post_body: {
          author: { name: "Jason Koebler", handle: "jasonkoebler.bsky.social", avatar: AVATAR },
          segments: [{ text: "the idea of some random guy making his chatbot write a press release about how his chatbot is a bad employee then emailing it to a bunch of journalists is still cracking me up" }],
          quote: {
            author: { name: "404 Media", handle: "404media.co", avatar: AVATAR },
            segments: [
              { text: "A man had his AI agent send journalists a press release accusing the agent of misconduct. We read all " },
              { text: "40 pages", kind: "link", href: "https://www.404media.co/x" },
              { text: " so you don't have to." },
            ],
            url: "https://bsky.app/profile/404media.co/post/3q",
            published_at: ago(0.6),
            media: "link",
          },
        },
      }),
      source_title: "Jason Koebler",
      source_icon_url: AVATAR,
      topic: { name: "Tech Press", slug: "tech-press", color: "#5f6f8f", icon: "" },
    }),
    conversation: conv("bluesky", { likes: 110, reposts: 20, replies: 3, quotes: 0 }, [
      reply("Reader", 4, "Genuinely the best thing in my inbox this week."),
    ]),
  },
  {
    key: "bsky-thread",
    section: "Tech",
    label: "Bluesky post · picture · 212 replies, nested",
    note: "#207: a reply-heavy post. Two replies on the card on a thread line, the rest one tap away; the reader nests replies to replies.",
    sel: sel({
      item: item({
        id: 43,
        source_kind: "bluesky",
        post: true,
        url: "https://bsky.app/profile/jason.bsky.social/post/3thr",
        title: "this story is extremely wild, major investigation from our team",
        text: "this story is extremely wild, major investigation from our team that took months. read it here: 404media.co/the-story...",
        content: "<p>body</p>",
        thumbnail_url: pic(1200, 675),
        likes: 2459,
        reposts: 640,
        replies: 212,
        published_at: ago(1),
        post_body: {
          author: { name: "Jason Koebler", handle: "jasonkoebler.bsky.social", avatar: AVATAR },
          segments: [
            { text: "this story is extremely wild, major investigation from our team that took months. read it here: " },
            { text: "404media.co/the-story...", kind: "link", href: "https://www.404media.co/the-story-in-full/" },
          ],
          images: [{ thumb: pic(1200, 675), alt: "A screenshot of the story", aspect: 1.778 }],
        },
      }),
      source_title: "Jason Koebler",
      source_icon_url: AVATAR,
      topic: { name: "Tech Press", slug: "tech-press", color: "#5f6f8f", icon: "" },
    }),
    conversation: conv("bluesky", { likes: 2459, reposts: 590, replies: 212, quotes: 50 }, [
      { ...reply("Dana Whitfield", 410, "The detail about the contractor invoices is going to be the part that sticks. That is a paper trail, not a vibe."), children: [reply("Jason Koebler", 120, "yes, and there is more of it coming")] },
      reply("mit1975eecs", 98, "Months of work and it shows. Subscribed."),
      reply("a bezoar", 2, "Link for anyone who missed it."),
    ]),
  },
  // #209: the card per type - Bluesky text, photo, link-only and reply-heavy
  // (above and here), a short Substack post drawn as a post, a long Substack
  // article with its counts and one comment, and a Medium post with no counts.
  {
    key: "bsky-link-only",
    section: "News",
    label: "Bluesky post · only a link",
    note: "#209: a post that is nothing but a link card. The card shows the link's title as one quiet line, not a card; the card itself is the reader's.",
    sel: sel({
      item: item({
        id: 44,
        source_kind: "bluesky",
        post: true,
        url: "https://bsky.app/profile/propublica.org/post/3lnk",
        title: "",
        text: "",
        content: "<p>body</p>",
        thumbnail_url: pic(1200, 630),
        likes: 41,
        reposts: 18,
        replies: 2,
        published_at: ago(0.2),
        post_body: {
          author: { name: "ProPublica", handle: "propublica.org", avatar: AVATAR },
          segments: [],
          link: {
            uri: "https://www.propublica.org/article/culvert-survey",
            title: "The State Knew Its Culverts Were Failing. It Kept the Survey Quiet for Six Years.",
            description: "Records show inspectors flagged hundreds of crossings, and the reports sat unpublished.",
            thumb: pic(1200, 630),
            domain: "propublica.org",
          },
        },
      }),
      source_title: "ProPublica",
      source_icon_url: AVATAR,
      topic: { name: "Investigations", slug: "investigations", color: "#5f6f8f", icon: "" },
    }),
  },
  {
    key: "substack-short",
    section: "Economics",
    label: "Substack · short post · chart · comments",
    note: "#209: a Substack post under the short-form threshold (Paul Krugman's one-chart travel-day post). Drawn as a post: title line, text, the chart, counts, two comments.",
    sel: sel({
      item: item({
        id: 45,
        source_kind: "substack",
        post: true,
        url: "https://paulkrugman.substack.com/p/trumpflation-and-travel",
        title: "Trumpflation and Travel",
        text: "Travel day, so just one chart — the Federal Reserve’s preferred measure of inflation, the last big data release before the midterms. Trump likes to stick his name on things, but this time he would be entirely justified: He personally built this, first with his tariffs and then with his war.",
        content: "<p>body</p>",
        thumbnail_url: pic(1240, 858),
        author: "Paul Krugman",
        likes: 1830,
        reposts: 96,
        replies: 214,
        published_at: ago(0.4),
        post_body: {
          author: { name: "Paul Krugman" },
          title: "Trumpflation and Travel",
          segments: [{ text: "Travel day, so just one chart — the Federal Reserve’s preferred measure of inflation, the last big data release before the midterms. Trump likes to stick his name on things, but this time he would be entirely justified: He personally built this, first with his tariffs and then with his war." }],
          images: [{ thumb: pic(1240, 858), alt: "", aspect: 1.445 }],
        },
      }),
      source_title: "Paul Krugman",
      source_icon_url: AVATAR,
      topic: { name: "Economics", slug: "economics", color: "#6a5f7a", icon: "" },
    }),
    conversation: conv("substack", { likes: 1830, reposts: 96, replies: 214, quotes: 0 }, [
      reply("Linda K", 120, "The chart says it all. Core PCE turned up right when the tariffs landed and never came back down."),
      reply("bgates", 64, "Safe travels. Thanks for posting even on the road."),
    ]),
  },
  {
    key: "substack-long",
    section: "Reading",
    label: "Substack article · hero · counts · one comment",
    note: "#209: a long Substack post keeps its article card - headline, hero, excerpt - with its counts row and its top comment when there is room.",
    sel: sel({
      item: item({
        id: 46,
        source_kind: "substack",
        url: "https://www.noahpinion.blog/p/the-housing-theory-of-everything",
        title: "The housing theory of everything, five years on",
        summary: "When the idea went viral in 2021 it sounded like a slogan. The data since then has made it look more like an accounting identity, and the places that built are now the places people can afford.",
        content: "<p>body</p>",
        thumbnail_url: pic(1456, 816),
        author: "Noah Smith",
        likes: 642,
        reposts: 58,
        replies: 233,
        published_at: ago(1.5),
      }),
      source_title: "Noahpinion",
      topic: { name: "Economics", slug: "economics", color: "#6a5f7a", icon: "" },
    }),
    conversation: conv("substack", { likes: 642, reposts: 58, replies: 233, quotes: 0 }, [
      reply("Mira Okafor", 88, "The Austin numbers are the cleanest natural experiment we are going to get, and the rent chart is hard to argue with."),
      reply("tlm", 31, "Would love a follow-up on what happened to construction costs over the same period."),
    ]),
  },
  {
    key: "medium-short",
    section: "Reading",
    label: "Medium · short post · no counts",
    note: "#209: a short Medium post drawn as a post. Medium reports no counts, so there is no counts row (not a row of zeros).",
    sel: sel({
      item: item({
        id: 47,
        source_kind: "medium",
        post: true,
        url: "https://medium.com/@ev/do-not-disturb-3622b4ddc3d8",
        title: "Do not disturb",
        text: "Can I assume when you’re in the zone\nYou’re not distracted by your phone\nShould I hold my texts\nAnd take time to reflect\nOr fire away\nBecause you have it at bay\n\nI don’t know\nIt’s hard to say\nI turn on Do Not Disturb every day",
        content: "<p>body</p>",
        author: "Ev Williams",
        published_at: ago(3),
        post_body: {
          author: { name: "Ev Williams" },
          title: "Do not disturb",
          segments: [{ text: "Can I assume when you’re in the zone\nYou’re not distracted by your phone\nShould I hold my texts\nAnd take time to reflect\nOr fire away\nBecause you have it at bay\n\nI don’t know\nIt’s hard to say\nI turn on Do Not Disturb every day" }],
        },
      }),
      source_title: "Ev Williams",
      source_icon_url: AVATAR,
      topic: { name: "Essays", slug: "essays", color: "#6a5f7a", icon: "" },
    }),
  },
  {
    key: "substack-comments",
    section: "Reading",
    label: "Substack article · hero · comments",
    note: "An article whose comments sit between the excerpt and the actions.",
    sel: sel({
      item: item({
        id: 22,
        source_kind: "substack",
        url: "https://www.astralcodexten.com/p/your-book-review-the-history-and",
        title: "Your Book Review: The History And Future Of Writing Systems",
        summary: "A finalist in this year's review contest takes on the long arc of how scripts were invented, borrowed and simplified.",
        content: "<p>body</p>",
        thumbnail_url: pic(1280, 720),
        author: "Anonymous",
        published_at: ago(4),
      }),
      source_title: "Astral Codex Ten",
      topic: { name: "Essays", slug: "essays", color: "#6a5f7a", icon: "" },
    }),
    conversation: conv("substack", { likes: 83, reposts: 3, replies: 61, quotes: 0 }, [
      reply("drosophilist", 4, "It is a long trip from a Japanese loanword to an English one, but the word had a full millennium to make it, and the review traces every step."),
      reply("SMK", 2, "I enjoyed this. I thought the first two sections were a good deal stronger than the third."),
    ]),
  },
  {
    key: "video-wide-comments",
    section: "Music Production",
    label: "Video · 16:9 · top comments",
    note: "A landscape long video with its top comments under the player.",
    sel: FIXTURES_VIDEO_WIDE(),
    conversation: conv("youtube", { likes: 52000, reposts: 0, replies: 1840, quotes: 0 }, [
      reply("modularmike", 2100, "The moment the tape loop locked to the clock I actually laughed out loud. Incredible patience on the rewire."),
      reply("Ines", 640, "Please do a follow-up where you play a full track on it."),
    ]),
  },
];

function FIXTURES_VIDEO_WIDE(): Selected {
  return sel({
    item: item({
      id: 23,
      source_kind: "youtube",
      title: "I built a drum machine out of a 1970s answering machine",
      media_type: "long",
      aspect_ratio: 16 / 9,
      duration_sec: 862,
      author: "Mattias Krantz",
      summary: "A teardown, a rewire, and a surprisingly usable sixteen-step sequencer.",
      thumbnail_url: pic(1280, 720, "dark"),
      url: "https://www.youtube.com/watch?v=ccccccccccc",
      published_at: ago(6),
    }),
    source_title: "Mattias Krantz",
    topic: { name: "Finger Drumming", slug: "finger-drumming", color: "#7a6a4f", icon: "music" },
  });
}

function reply(author: string, likes: number, text: string, media?: ConversationComment["media"]): ConversationComment {
  return { author, likes, text, replies: 0, media, published_at: ago(0.2) };
}

function conv(platform: Conversation["platform"], counts: Conversation["counts"], replies: ConversationComment[], quoted?: ConversationComment): Conversation {
  return { platform, counts, replies, quotes: [], quoted, url: "https://example.org/", fetched_at: NOW };
}

export const FIXTURE_BY_KEY: Record<string, Fixture> = Object.fromEntries(FIXTURES.map((f) => [f.key, f]));
