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

const NOW = "2026-08-16T12:00:00Z";
function ago(days: number): string {
  return new Date(Date.parse(NOW) - days * 86400_000).toISOString();
}

function item(over: Partial<Item>): Item {
  return {
    id: 1,
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
        url: "https://bsky.app/profile/someone.bsky.social/post/3abc",
        title: "This is the most honest release note I have read all year.",
        summary: "They reverted ten features rather than ship something reviewers could not keep up with. More projects should be willing to say that out loud.",
        content: "<p>body</p>",
        author: "Kelsey Ortiz",
        published_at: ago(0.3),
      }),
      source_title: "Kelsey Ortiz",
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
        url: "https://bsky.app/profile/someone.bsky.social/post/3abd",
        title: "Found the original wiring diagram for the building, hand drawn in 1931.",
        summary: "Every circuit labelled in the same careful hand. Somebody spent weeks on this.",
        content: "<p>body</p>",
        thumbnail_url: pic(1200, 900),
        author: "Sam Reyes",
        published_at: ago(1),
      }),
      source_title: "Sam Reyes",
      topic: { name: "Old Things", slug: "old", color: "#7a6a4f", icon: "" },
    }),
    conversation: conv("bluesky", { likes: 2400, reposts: 310, replies: 96, quotes: 22 }, [
      reply("Ruth Allen", 380, "The lettering on the panel schedule is gorgeous. Draftsmen used to train for years to letter like that and it shows in every label on the sheet."),
      reply("Theo", 122, "Please scan it at high resolution before anything happens to it. Archives would love this."),
    ]),
  },
  {
    key: "substack-comments",
    section: "Reading",
    label: "Substack article · hero · comments",
    note: "An article whose comments sit between the excerpt and the actions.",
    sel: sel({
      item: item({
        id: 22,
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
