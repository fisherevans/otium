import { Fragment, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { ChevronRight, ExternalLink, Heart, MessageCircle, Play, Quote as QuoteIcon, Repeat2 } from "lucide-react";
import type { Conversation, ConversationComment, Item, PostAuthor, PostBody, PostImage, PostLink, PostQuote, PostSegment, PostVideo } from "@/api/client";
import { compactCount, moreLabel, platformName, useConversationPages } from "@/lib/conversation";
import { fmtDate, relTime } from "@/lib/format";
import { PlatformMark } from "./PlatformMark";
import "./post.css";

// A social post, drawn the way its platform draws it (#207). Articles look like
// articles and videos like videos; a Bluesky post is a post: a card with the
// author on top, the text with its links working, what is attached (pictures, a
// compact link card, a quoted post), the replies/reposts/likes row directly under
// it, and the replies hanging off it as a thread.
//
// One component serves the session card and the reader, so the two cannot drift.
// The card is laid out by the runtime solver (lib/cardLayout): `.cv-card-replies >
// .cv-row` are the replies it gives up first, then the picture steps down, and
// `.card-post` is the text it trims last.
//
// #209: the card is the post's text, its picture, its counts and a reply or two.
// #210 put the link card and the quoted post back on the card: a post that says
// "see these are amazing" means nothing without what it quotes, and most news
// accounts post a line over a link. A quoted post is drawn the way embeds and
// screenshots draw one - inset, with its author, handle, time, text and its own
// pictures, link card or video - and one that cannot be shown says so. Short Substack and Medium
// posts (classified on the server) are drawn by the same component, with their
// platform's mark, their publication under the author, and their title above the
// text. Medium has no counts, so no counts row.
//
// Every string comes from another site. Text renders as React text; the only
// links are the server's segment hrefs (always http(s)) and the post's own URLs.

/** Links inside a card must not also be a tap on the card or a swipe. */
const stop = (e: SyntheticEvent) => e.stopPropagation();
const linkProps = { target: "_blank", rel: "noopener noreferrer", onClick: stop, onPointerDown: stop, onPointerUp: stop } as const;

/** A post's text with its links (mentions, hashtags, shortened URLs). */
export function RichText({ segments, text }: { segments?: PostSegment[]; text?: string }) {
  if (!segments?.length) return <>{text ?? ""}</>;
  return (
    <>
      {segments.map((s, i) =>
        s.href ? (
          <a key={i} className={`bp-link bp-${s.kind ?? "link"}`} href={s.href} {...linkProps}>
            {s.text}
          </a>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}

function Avatar({ author, size }: { author: PostAuthor; size: "lg" | "sm" | "xs" }) {
  const [broken, setBroken] = useState(false);
  if (author.avatar && !broken) {
    return <img className={`bp-avatar bp-avatar-${size}`} src={author.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className={`bp-avatar bp-avatar-${size} bp-mono`} aria-hidden>{(author.name.trim()[0] || "?").toUpperCase()}</span>;
}

/** The platform's mark in its own colour (the Bluesky butterfly in Bluesky blue,
 *  Substack orange, Medium ink), so the platform reads at a glance. */
export function PostPlatformMark({ platform = "bluesky" }: { platform?: string }) {
  return (
    <span className={`bp-platform bp-platform-${platform}`} title={platformName(platform) || platform}>
      <PlatformMark kind={platform} size={16} />
    </span>
  );
}

/** @deprecated kept for callers that predate #209. */
export function BlueskyMark() {
  return <PostPlatformMark platform="bluesky" />;
}

function PostHeader({ author, publishedAt, full, onAuthor, platform, context }: { author: PostAuthor; publishedAt?: string; full: boolean; onAuthor?: () => void; platform: string; context?: string }) {
  const when = publishedAt ? (full ? fmtDate(publishedAt) : relTime(publishedAt)) : "";
  const who = (
    <>
      <Avatar author={author} size="lg" />
      <span className="bp-who">
        <span className="bp-name">{author.name}</span>
        <span className="bp-sub">
          {/* The time first: a long handle truncates, the time never does. */}
          {when && <span className="bp-when">{when}</span>}
          {(author.handle || context) && when && <span aria-hidden> · </span>}
          {author.handle ? <span className="bp-handle">@{author.handle}</span> : context ? <span className="bp-handle">{context}</span> : null}
        </span>
      </span>
    </>
  );
  return (
    <div className="bp-head">
      {onAuthor ? (
        <button type="button" className="bp-author" onPointerDown={stop} onClick={(e) => { e.stopPropagation(); onAuthor(); }}>{who}</button>
      ) : author.url ? (
        <a className="bp-author" href={author.url} {...linkProps}>{who}</a>
      ) : (
        <span className="bp-author">{who}</span>
      )}
      <PostPlatformMark platform={platform} />
    </div>
  );
}

/** Pictures: the post's own (`post`), a quoted post's (`quote`, smaller), or a
 *  reply's (`reply`: a strip of thumbnails on the card, a small grid in the reader). */
function Images({ images, variant = "post" }: { images: PostImage[]; variant?: "post" | "quote" | "reply" }) {
  const shown = images.slice(0, 4);
  return (
    <div className={`bp-images bp-images-${shown.length} bp-images-${variant}`}>
      {shown.map((im, i) => (
        <img key={i} src={variant === "post" ? im.full || im.thumb : im.thumb || im.full} alt={im.alt ?? ""} loading="lazy" referrerPolicy="no-referrer"
          style={shown.length === 1 && im.aspect ? { aspectRatio: String(im.aspect) } : undefined} />
      ))}
    </div>
  );
}

/**
 * The external link card. `large` (the post's only attachment) is Bluesky's and
 * X's big card: the page's picture across the top, then title, description and
 * domain. `compact` (beside pictures, inside a quote, under a reply) is a thumbnail
 * beside the title and domain. The session solver can turn a large card compact.
 */
function LinkCard({ link, size, full }: { link: PostLink; size: "large" | "compact"; full: boolean }) {
  const [broken, setBroken] = useState(false);
  const thumb = link.thumb && !broken;
  return (
    <a className={`bp-linkcard bp-linkcard-${size} ${thumb ? "" : "bp-linkcard-nothumb"}`} href={link.uri} {...linkProps}>
      {thumb && (
        <img className="bp-link-thumb" src={link.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      )}
      <span className="bp-link-text">
        <span className="bp-link-domain">{link.domain || link.uri}</span>
        {link.title && <span className="bp-link-title">{link.title}</span>}
        {link.description && (full || size === "large") && <span className="bp-link-desc">{link.description}</span>}
      </span>
    </a>
  );
}

/** Whether this browser plays an HLS playlist in a <video> (Safari, iOS). */
function playsHLS(): boolean {
  if (typeof document === "undefined") return false;
  return document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";
}

/**
 * A post's video (#210). The poster with a play button; a tap plays it right
 * there, with the platform's own controls, where the browser plays HLS (Safari
 * on iPhone does). Elsewhere, or with no playlist, the tap opens the post. It
 * pauses when it scrolls out of view, and never starts on its own.
 */
function VideoPoster({ video, url }: { video: PostVideo; url?: string }) {
  const [playing, setPlaying] = useState(false);
  // The poster's height when tapped: the player takes the same box, so the card
  // the solver laid out does not move.
  const [height, setHeight] = useState<number | undefined>();
  const ref = useRef<HTMLVideoElement | null>(null);
  const inline = !!video.playlist && playsHLS();
  const box = video.aspect ? { aspectRatio: String(video.aspect) } : undefined;

  useEffect(() => {
    const el = ref.current;
    if (!playing || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => !e.isIntersecting)) el.pause();
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [playing]);

  if (playing && video.playlist) {
    return (
      <div className="bp-video bp-video-playing" style={height ? { height } : box} onClick={stop} onPointerDown={stop} onPointerUp={stop}>
        <video ref={ref} src={video.playlist} poster={video.thumb} controls playsInline autoPlay preload="auto" />
      </div>
    );
  }
  const body = (
    <>
      {video.thumb ? <img src={video.thumb} alt="Video" loading="lazy" referrerPolicy="no-referrer" /> : <span className="bp-video-blank" />}
      <span className="bp-play" aria-hidden><Play size={20} strokeWidth={2} /></span>
    </>
  );
  if (inline) {
    return (
      <button type="button" className="bp-video" aria-label="Play video" onPointerDown={stop} onPointerUp={stop}
        onClick={(e) => { e.stopPropagation(); setHeight(e.currentTarget.offsetHeight || undefined); setPlaying(true); }}>
        {body}
      </button>
    );
  }
  return url ? (
    <a className="bp-video" href={url} aria-label="Watch on Bluesky" {...linkProps}>{body}</a>
  ) : (
    <div className="bp-video">{body}</div>
  );
}

function mediaWord(m?: string) {
  return m === "image" ? "Image" : m === "video" ? "Video" : m === "link" ? "Link" : "";
}

/** A quoted post's pictures; one stored before #210 has only its first thumbnail. */
function quoteImages(q: PostQuote): PostImage[] | undefined {
  if (q.images?.length) return q.images;
  return q.media === "image" && q.thumb ? [{ thumb: q.thumb }] : undefined;
}

const sharedWord: Record<string, string> = { feed: "Feed", list: "List", "starter pack": "Starter pack" };

/**
 * What a post quotes, inset (#210). A quoted post shows its author (name, handle,
 * time), its text, and its own pictures, video or link card, smaller than the
 * post's; a quote inside it is named on one line, as Bluesky does. A post that
 * cannot be shown says why. A shared feed, list or starter pack is a small card.
 *
 * In the reader the whole quote opens the quoted post: its header is the link and
 * stretches over the quote (links inside it sit above). On the session card a tap
 * on the quote is a tap on the card, which opens the reader.
 */
function QuoteCard({ quote, full }: { quote: PostQuote; full: boolean }) {
  if (quote.kind === "unavailable") {
    return (
      <div className="bp-quote bp-quote-gone">
        <QuoteIcon size={14} strokeWidth={1.8} aria-hidden />
        <span>{quote.notice || "The quoted post isn't available"}</span>
      </div>
    );
  }
  if (quote.kind) {
    const by = quote.author.name ? `${sharedWord[quote.kind] ?? "Shared"} by ${quote.author.name}` : sharedWord[quote.kind] ?? "";
    const inner = (
      <>
        {quote.thumb && <img className="bp-shared-thumb" src={quote.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <span className="bp-link-text">
          <span className="bp-link-domain">{by}</span>
          <span className="bp-link-title">{quote.title || sharedWord[quote.kind]}</span>
          {quote.description && full && <span className="bp-link-desc">{quote.description}</span>}
        </span>
      </>
    );
    return quote.url ? (
      <a className="bp-linkcard bp-linkcard-compact bp-shared" href={quote.url} {...linkProps}>{inner}</a>
    ) : (
      <div className="bp-linkcard bp-linkcard-compact bp-shared">{inner}</div>
    );
  }
  const name = quote.author.name || quote.author.handle || "";
  const head = (
    <>
      <Avatar author={quote.author} size="xs" />
      <span className="bp-name">{name}</span>
      {quote.author.handle && quote.author.handle !== name && <span className="bp-handle">@{quote.author.handle}</span>}
      {quote.published_at && <span className="bp-when"><span aria-hidden>· </span>{relTime(quote.published_at)}</span>}
    </>
  );
  const images = quoteImages(quote);
  const text = quote.segments.map((s) => s.text).join("").trim();
  const legacy = !images && !quote.video && !quote.link ? mediaWord(quote.media) : "";
  return (
    <div className="bp-quote" aria-label={`Quoting ${name}`}>
      {full && quote.url ? (
        <a className="bp-quote-head bp-quote-open" href={quote.url} aria-label={`${name}'s post, on Bluesky`} {...linkProps}>{head}</a>
      ) : (
        <span className="bp-quote-head">{head}</span>
      )}
      {text && <span className="bp-quote-text"><RichText segments={trimSegments(quote.segments)} /></span>}
      {images && <Images images={images} variant="quote" />}
      {quote.video && <VideoPoster video={quote.video} url={full ? quote.url : undefined} />}
      {quote.link && <LinkCard link={quote.link} size="compact" full={full} />}
      {legacy && <span className="bp-quote-media">{legacy}</span>}
      {quote.quoting && (
        <span className="bp-quote-quoting">
          <QuoteIcon size={12} strokeWidth={2} aria-hidden />
          Quoting {quote.quoting}
        </span>
      )}
    </div>
  );
}

/** Replies, reposts and likes, under the post. */
export function EngagementRow({ replies, reposts, likes }: { replies: number; reposts: number; likes: number }) {
  const cell = (n: number, icon: ReactNode, one: string, many: string) => (
    <span className="bp-count" aria-label={`${n} ${n === 1 ? one : many}`}>
      {icon}
      <span aria-hidden>{n > 0 ? compactCount(n) : ""}</span>
    </span>
  );
  return (
    <div className="bp-engagement">
      {cell(replies, <MessageCircle size={17} strokeWidth={1.8} aria-hidden />, "reply", "replies")}
      {cell(reposts, <Repeat2 size={18} strokeWidth={1.8} aria-hidden />, "repost", "reposts")}
      {cell(likes, <Heart size={16} strokeWidth={1.8} aria-hidden />, "like", "likes")}
    </div>
  );
}

/**
 * The post itself, in its card. `full` is the reader: the whole text, the full
 * date and the link card's description. Both draw what is attached, in Bluesky's
 * order: pictures or video, the link card, then the quoted post (#210). The link
 * card is large when it is all the post carries. `counts` null means the platform
 * has none (Medium).
 */
export function PostCard({
  body,
  publishedAt,
  url,
  counts,
  full = false,
  onAuthor,
  platform = "bluesky",
  context,
}: {
  body: PostBody;
  publishedAt?: string;
  url?: string;
  counts: { replies: number; reposts: number; likes: number } | null;
  full?: boolean;
  onAuthor?: () => void;
  /** The source kind: bluesky | substack | medium. */
  platform?: string;
  /** A line under the author instead of a handle: the publication. */
  context?: string;
}) {
  const text = body.segments.map((s) => s.text).join("").trim();
  const linkSize = !body.images?.length && !body.video && !body.quote ? "large" : "compact";
  return (
    <article className={`bsky-post bp-${platform} ${full ? "bp-full" : ""}`} aria-label={`Post by ${body.author.name}`}>
      <PostHeader author={body.author} publishedAt={publishedAt} full={full} onAuthor={onAuthor} platform={platform} context={context} />
      {body.title && <h3 className="bp-title">{body.title}</h3>}
      {text && <p className="card-post bp-text"><RichText segments={trimSegments(body.segments)} /></p>}
      {body.images?.length ? <Images images={body.images} /> : null}
      {body.video && <VideoPoster video={body.video} url={url} />}
      {body.link && <LinkCard link={body.link} size={linkSize} full={full} />}
      {body.quote && <QuoteCard quote={body.quote} full={full} />}
      {counts && <EngagementRow {...counts} />}
    </article>
  );
}

/** Drop trailing whitespace the record carries, keeping the segments intact. */
function trimSegments(segs: PostSegment[]): PostSegment[] {
  const out = segs.slice();
  while (out.length && !out[out.length - 1].href && !out[out.length - 1].text.trim()) out.pop();
  if (out.length && !out[out.length - 1].href) out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text.trimEnd() };
  if (out.length && !out[0].href) out[0] = { ...out[0], text: out[0].text.trimStart() };
  return out;
}

function ReplyText({ c }: { c: ConversationComment }) {
  return <RichText segments={c.segments} text={c.text} />;
}

/**
 * What a reply carries (#210), under its text. In the reader: its pictures as a
 * small grid, its video poster, a compact link card and the post it quotes. On the
 * card, where a reply is a line or two: a strip of thumbnails, and the link or the
 * quoted post named on one line.
 */
function ReplyAttachments({ c, full }: { c: ConversationComment; full: boolean }) {
  if (full) {
    return (
      <div className="bp-reply-att">
        {c.images?.length ? <Images images={c.images} variant="reply" /> : null}
        {c.video && <VideoPoster video={c.video} url={c.url} />}
        {c.link && <LinkCard link={c.link} size="compact" full={false} />}
        {c.quote && <QuoteCard quote={c.quote} full />}
      </div>
    );
  }
  const pics = c.images?.length ? c.images : c.video?.thumb ? [{ thumb: c.video.thumb }] : [];
  const note = c.quote
    ? c.quote.kind === "unavailable" ? "Quoting a post that isn't available" : `Quoting ${c.quote.kind ? c.quote.title || c.quote.kind : c.quote.author.name}`
    : c.link ? c.link.title || c.link.domain || "" : "";
  return (
    <div className="bp-reply-att">
      {pics.length > 0 && <Images images={pics} variant="reply" />}
      {note && <span className="bp-reply-note">{c.quote ? <QuoteIcon size={12} strokeWidth={2} aria-hidden /> : null}{note}</span>}
    </div>
  );
}

/** What the reader's thread needs to load the replies under a reply (#209). */
interface Expander {
  expand: (id: string) => void;
  expanding: Record<string, "loading" | "error">;
  platform: string;
}

/** One reply in the thread; `depth` > 0 nests the replies to it (reader). */
function ThreadReply({ c, depth, full, more, level = 0 }: { c: ConversationComment; depth: number; full: boolean; more?: Expander; level?: number }) {
  const author: PostAuthor = { name: c.author, avatar: c.avatar_url, handle: c.handle };
  const attached = !!(c.images?.length || c.video || c.link || c.quote);
  const media = attached ? "" : mediaWord(c.media);
  const where = more ? platformName(more.platform) : "Bluesky";
  const hidden = c.more_replies ?? 0;
  const canExpand = !!(more && c.id && hidden > 0);
  const state = c.id ? more?.expanding[c.id] : undefined;
  const kids = c.children ?? [];
  // Below three levels the indent stops growing - a phone has no room for more -
  // so deeper replies follow their parent at the same indent.
  const flat = level >= 2;
  const nested = depth > 0 && kids.length > 0 && !flat;
  return (
    <>
    <li className="cv-row bp-reply">
      <Avatar author={author} size="sm" />
      <div className="bp-reply-main">
        <div className="cv-head">
          <span className="cv-author">{c.author}</span>
          {full && c.published_at && <span className="cv-age">{relTime(c.published_at)}</span>}
          {c.likes > 0 && (
            <span className="cv-likes" aria-label={`${c.likes} ${c.likes === 1 ? "like" : "likes"}`}>
              <Heart size={11} strokeWidth={2} aria-hidden />
              {compactCount(c.likes)}
            </span>
          )}
          {full && c.url && (
            <a className="cv-link bp-reply-open" href={c.url} aria-label={`Open ${c.author}'s reply on ${where}`} {...linkProps}>
              <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
            </a>
          )}
        </div>
        {c.text && <p className="cv-text"><ReplyText c={c} /></p>}
        {attached && <ReplyAttachments c={c} full={full} />}
        {(media || (full && c.replies > 0 && !kids.length && !canExpand)) && (
          <div className="cv-foot">
            {media && <span>{media}</span>}
            {full && c.replies > 0 && !kids.length && !canExpand && <span>{compactCount(c.replies)} {c.replies === 1 ? "reply" : "replies"}</span>}
          </div>
        )}
        {nested && (
          <ol className="cv-list bp-children">
            {kids.map((k, i) => <ThreadReply key={k.id || i} c={k} depth={depth - 1} full={full} more={more} level={level + 1} />)}
          </ol>
        )}
        {full && canExpand && (
          <button type="button" className="bp-expand" disabled={state === "loading"} onClick={() => c.id && more!.expand(c.id)}>
            {state === "loading"
              ? "Loading replies…"
              : state === "error"
              ? "Couldn't load replies · Retry"
              : `${kids.length ? "Show " + compactCount(hidden) + " more" : "Show " + compactCount(hidden)} ${hidden === 1 ? "reply" : "replies"}`}
          </button>
        )}
      </div>
    </li>
    {flat && depth > 0 && kids.map((k, i) => <ThreadReply key={k.id || i} c={k} depth={depth - 1} full={full} more={more} level={level + 1} />)}
    </>
  );
}

/**
 * The card's replies: the two most-liked, hanging off the post on a thread line,
 * then "N more replies", which opens the reader.
 */
export function CardThread({ conv, onMore }: { conv: Conversation; onMore?: () => void }) {
  const top = conv.replies.slice(0, 2);
  const more = moreLabel(conv, top.length);
  // The solver may hide one or both replies (data-solved-conv); the link then
  // counts what is actually hidden, so each variant is rendered and CSS shows one.
  const moreOne = top.length > 1 ? moreLabel(conv, 1) : more;
  const moreNone = top.length > 0 ? moreLabel(conv, 0) : more;
  if (!top.length && !(more && onMore)) return null;
  return (
    <div className="card-conv bp-thread">
      {top.length > 0 && (
        <ol className="cv-list cv-card-replies" aria-label="Top replies">
          {top.map((c, i) => <ThreadReply key={i} c={c} depth={0} full={false} />)}
        </ol>
      )}
      {(more || moreNone) && onMore && (
        <button type="button" className="cv-more" onPointerDown={stop}
          onClick={(e) => { e.stopPropagation(); onMore(); }}>
          {more && <span className="bp-more-all">{more}</span>}
          <span className="bp-more-one">{moreOne}</span>
          <span className="bp-more-none">{moreNone}</span>
          <ChevronRight size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * The reader's conversation under a post or an article (#200, #207, #209):
 * replies threaded, then quotes, then the platform (#210: not who reposted) - and it
 * keeps going as you scroll. The next page loads as its end comes near; while a
 * page is due the reader's pull-to-next stays off (`onPending`), so the pull only
 * engages once there is nothing more to load.
 */
export function ReaderThread({
  conv,
  item,
  url,
  status,
  platform = "bluesky",
  onPending,
}: {
  conv: Conversation | null;
  item?: Item | null;
  url?: string;
  /** The first page's state: none | loading | ready | error. */
  status: string;
  platform?: string;
  /** True while more of the conversation is on its way or still to load. */
  onPending?: (pending: boolean) => void;
}) {
  const pages = useConversationPages(item, conv);
  const open = conv?.url || url;
  const where = platformName(conv?.platform ?? platform) || "the original";
  const bsky = (conv?.platform ?? platform) === "bluesky";
  const sentinel = useRef<HTMLDivElement | null>(null);
  const more: Expander = { expand: pages.expand, expanding: pages.expanding, platform: conv?.platform ?? platform };
  const pending = status === "loading" || (pages.hasMore && pages.status !== "error");
  const anything = pages.replies.length > 0 || pages.quotes.length > 0;

  useEffect(() => {
    onPending?.(pending);
  }, [pending, onPending]);
  useEffect(() => () => onPending?.(false), [onPending]);

  // Load the next page as the end of what is shown comes within a screen.
  // Re-observed after every page, so a short page that leaves the end in view
  // asks for the next one too.
  const { hasMore, status: pageStatus, loadMore } = pages;
  const shown = pages.replies.length + pages.quotes.length;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || pageStatus !== "idle" || typeof IntersectionObserver === "undefined") return;
    const root = el.closest<HTMLElement>(".readerpage-body");
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { root, rootMargin: "0px 0px 900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, pageStatus, loadMore, shown]);

  return (
    <div className="rp-conv bp-reader-thread" id="conversation">
      {pages.replies.length > 0 && (
        <section className="cv-section">
          <h2 className="cv-heading">{bsky ? "Replies" : "Comments"}</h2>
          <ol className="cv-list bp-thread-list">{pages.replies.map((c, i) => <ThreadReply key={c.id || i} c={c} depth={8} full more={more} />)}</ol>
        </section>
      )}
      {pages.quotes.length > 0 && (
        <section className="cv-section">
          <h2 className="cv-heading">Quotes</h2>
          <ol className="cv-list bp-thread-list">{pages.quotes.map((c, i) => <ThreadReply key={c.id || i} c={c} depth={0} full />)}</ol>
        </section>
      )}
      {conv && !anything && !pages.hasMore && <p className="cv-empty">No {bsky ? "replies" : "comments"} yet.</p>}
      {!conv && status === "loading" && <p className="cv-empty">Loading {bsky ? "replies" : "comments"}…</p>}
      {!conv && status === "error" && <p className="cv-empty">{bsky ? "Replies" : "Comments"} couldn't load.</p>}
      <div ref={sentinel} className="cv-sentinel" aria-hidden />
      {conv && pages.status === "loading" && <p className="cv-paging" role="status">Loading more…</p>}
      {conv && pages.status === "error" && (
        <p className="cv-paging" role="status">
          Couldn't load more ·{" "}
          <button type="button" className="cv-retry" onClick={pages.loadMore}>Retry</button>
        </p>
      )}
      {conv && anything && !pages.hasMore && pages.status !== "error" && <p className="cv-paging cv-end">End of the conversation</p>}
      {open && (
        <a className="reader-open cv-open" href={open} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={15} strokeWidth={1.75} aria-hidden />
          Open on {where}
        </a>
      )}
    </div>
  );
}
