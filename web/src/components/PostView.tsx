import { Fragment, useState, type ReactNode, type SyntheticEvent } from "react";
import { ChevronRight, ExternalLink, Heart, MessageCircle, Play, Repeat2 } from "lucide-react";
import type { Conversation, ConversationComment, PostAuthor, PostBody, PostSegment } from "@/api/client";
import { compactCount, moreLabel } from "@/lib/conversation";
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
// The card is laid out by the runtime solver (lib/cardLayout): `.card-post` is the
// text it trims last, `.bp-link-desc` the link card's description it drops before
// that, and `.cv-card-replies > .cv-row` the replies it gives up first.
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

function Avatar({ author, size }: { author: PostAuthor; size: "lg" | "sm" }) {
  const [broken, setBroken] = useState(false);
  if (author.avatar && !broken) {
    return <img className={`bp-avatar bp-avatar-${size}`} src={author.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className={`bp-avatar bp-avatar-${size} bp-mono`} aria-hidden>{(author.name.trim()[0] || "?").toUpperCase()}</span>;
}

/** The Bluesky butterfly in its own blue, so the platform reads at a glance. */
export function BlueskyMark() {
  return (
    <span className="bp-platform" title="Bluesky">
      <PlatformMark kind="bluesky" size={16} />
    </span>
  );
}

function PostHeader({ author, publishedAt, full, onAuthor }: { author: PostAuthor; publishedAt?: string; full: boolean; onAuthor?: () => void }) {
  const when = publishedAt ? (full ? fmtDate(publishedAt) : relTime(publishedAt)) : "";
  const who = (
    <>
      <Avatar author={author} size="lg" />
      <span className="bp-who">
        <span className="bp-name">{author.name}</span>
        <span className="bp-sub">
          {/* The time first: a long handle truncates, the time never does. */}
          {when && <span className="bp-when">{when}</span>}
          {author.handle && when && <span aria-hidden> · </span>}
          {author.handle && <span className="bp-handle">@{author.handle}</span>}
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
      <BlueskyMark />
    </div>
  );
}

function Images({ images }: { images: NonNullable<PostBody["images"]> }) {
  const shown = images.slice(0, 4);
  return (
    <div className={`bp-images bp-images-${shown.length}`}>
      {shown.map((im, i) => (
        <img key={i} src={im.full || im.thumb} alt={im.alt ?? ""} loading="lazy" referrerPolicy="no-referrer"
          style={shown.length === 1 && im.aspect ? { aspectRatio: String(im.aspect) } : undefined} />
      ))}
    </div>
  );
}

/** The external link card, compact like Bluesky's: picture, title, description, domain. */
function LinkCard({ link }: { link: NonNullable<PostBody["link"]> }) {
  const [broken, setBroken] = useState(false);
  return (
    <a className="bp-linkcard" href={link.uri} {...linkProps}>
      {link.thumb && !broken && (
        <img className="bp-link-thumb" src={link.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      )}
      <span className="bp-link-text">
        {link.title && <span className="bp-link-title">{link.title}</span>}
        {link.description && <span className="bp-link-desc">{link.description}</span>}
        <span className="bp-link-domain">{link.domain || link.uri}</span>
      </span>
    </a>
  );
}

function VideoPoster({ video, url }: { video: NonNullable<PostBody["video"]>; url?: string }) {
  const body = (
    <>
      {video.thumb ? <img src={video.thumb} alt="Video" loading="lazy" referrerPolicy="no-referrer" /> : <span className="bp-video-blank" />}
      <span className="bp-play" aria-hidden><Play size={20} strokeWidth={2} /></span>
    </>
  );
  return url ? (
    <a className="bp-video" href={url} aria-label="Watch on Bluesky" {...linkProps}>{body}</a>
  ) : (
    <div className="bp-video">{body}</div>
  );
}

function mediaWord(m?: string) {
  return m === "image" ? "Image" : m === "video" ? "Video" : m === "link" ? "Link" : "";
}

function QuoteCard({ quote }: { quote: NonNullable<PostBody["quote"]> }) {
  const inner = (
    <>
      <span className="bp-quote-head">
        <Avatar author={quote.author} size="sm" />
        <span className="bp-name">{quote.author.name}</span>
        {quote.published_at && <span className="bp-when">{relTime(quote.published_at)}</span>}
      </span>
      <span className="bp-quote-text"><RichText segments={quote.segments} /></span>
      {quote.media && <span className="bp-quote-media">{mediaWord(quote.media)}</span>}
    </>
  );
  // A link inside a link is invalid markup, so a quote with links in its text is
  // not itself a link; "Open" covers it in the reader.
  const nested = quote.segments.some((s) => s.href);
  return quote.url && !nested ? (
    <a className="bp-quote" href={quote.url} {...linkProps}>{inner}</a>
  ) : (
    <div className="bp-quote">{inner}</div>
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
 * The post itself, in its card. `full` is the reader: the whole text, full date,
 * the link card's description unclamped.
 */
export function PostCard({
  body,
  publishedAt,
  url,
  counts,
  full = false,
  onAuthor,
}: {
  body: PostBody;
  publishedAt?: string;
  url?: string;
  counts: { replies: number; reposts: number; likes: number };
  full?: boolean;
  onAuthor?: () => void;
}) {
  const text = body.segments.map((s) => s.text).join("").trim();
  return (
    <article className={`bsky-post ${full ? "bp-full" : ""}`} aria-label={`Post by ${body.author.name}`}>
      <PostHeader author={body.author} publishedAt={publishedAt} full={full} onAuthor={onAuthor} />
      {text && <p className="card-post bp-text"><RichText segments={trimSegments(body.segments)} /></p>}
      {body.images?.length ? <Images images={body.images} /> : null}
      {body.video && <VideoPoster video={body.video} url={url} />}
      {body.link && <LinkCard link={body.link} />}
      {body.quote && <QuoteCard quote={body.quote} />}
      <EngagementRow {...counts} />
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

/** One reply in the thread; `depth` > 0 nests the replies to it (reader). */
function ThreadReply({ c, depth, full }: { c: ConversationComment; depth: number; full: boolean }) {
  const author: PostAuthor = { name: c.author, avatar: c.avatar_url, handle: c.handle };
  const media = mediaWord(c.media);
  return (
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
            <a className="cv-link bp-reply-open" href={c.url} aria-label={`Open ${c.author}'s reply on Bluesky`} {...linkProps}>
              <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
            </a>
          )}
        </div>
        {c.text && <p className="cv-text"><ReplyText c={c} /></p>}
        {(media || (full && c.replies > 0 && !c.children?.length)) && (
          <div className="cv-foot">
            {media && <span>{media}</span>}
            {full && c.replies > 0 && !c.children?.length && <span>{compactCount(c.replies)} {c.replies === 1 ? "reply" : "replies"}</span>}
          </div>
        )}
        {depth > 0 && c.children && c.children.length > 0 && (
          <ol className="cv-list bp-children">
            {c.children.map((k, i) => <ThreadReply key={i} c={k} depth={depth - 1} full={full} />)}
          </ol>
        )}
      </div>
    </li>
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

/** The reader's conversation under a post: replies threaded, then quotes, then Bluesky. */
export function ReaderThread({ conv, url, status }: { conv: Conversation | null; url?: string; status: string }) {
  const open = conv?.url || url;
  return (
    <div className="rp-conv bp-reader-thread" id="conversation">
      {conv && conv.replies.length > 0 && (
        <section className="cv-section">
          <h2 className="cv-heading">Replies</h2>
          <ol className="cv-list bp-thread-list">{conv.replies.map((c, i) => <ThreadReply key={i} c={c} depth={3} full />)}</ol>
        </section>
      )}
      {conv && conv.quotes.length > 0 && (
        <section className="cv-section">
          <h2 className="cv-heading">Quotes</h2>
          <ol className="cv-list bp-thread-list">{conv.quotes.map((c, i) => <ThreadReply key={i} c={c} depth={0} full />)}</ol>
        </section>
      )}
      {conv && conv.replies.length === 0 && conv.quotes.length === 0 && <p className="cv-empty">No replies yet.</p>}
      {!conv && status === "loading" && <p className="cv-empty">Loading replies…</p>}
      {!conv && status === "error" && <p className="cv-empty">Replies couldn't load.</p>}
      {open && (
        <a className="reader-open cv-open" href={open} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={15} strokeWidth={1.75} aria-hidden />
          Open on Bluesky
        </a>
      )}
    </div>
  );
}
