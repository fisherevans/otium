import { useCallback, useEffect } from "react";
import { ChevronRight, ExternalLink, Heart, MessageCircle } from "lucide-react";
import type { Conversation as Conv, ConversationComment, Item } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { compactCount, hasConversation, moreLabel, platformName, useConversationState } from "@/lib/conversation";
import { postRowCounts } from "@/lib/posts";
import { EngagementRow, ReaderThread } from "./PostView";
import { relTime } from "@/lib/format";
import "./conversation.css";

// The conversation around an item (#200). Three surfaces share one comment row:
//
//   CardConversation   on the session card: counts, the quoted post as an inset,
//                      the two most-liked replies, and a link to the rest
//   ReaderConversation in the reader, under the post: every reply most-liked
//                      first, then quotes, then a link to the platform
//   ConversationSheet  an overlay for videos (Shorts, and "more" on long videos)
//
// Every string here comes from another site. It is rendered as React text, never
// as HTML, and links point only at URLs the server built.

function mediaLabel(m?: ConversationComment["media"]) {
  return m === "image" ? "Image" : m === "video" ? "Video" : m === "link" ? "Link" : "";
}

function Likes({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="cv-likes" aria-label={`${n} ${n === 1 ? "like" : "likes"}`}>
      <Heart size={11} strokeWidth={2} aria-hidden />
      {compactCount(n)}
    </span>
  );
}

/** One reply, quote or comment. `full` adds the date, reply count and a link. */
export function CommentRow({ c, full = false }: { c: ConversationComment; full?: boolean }) {
  const media = mediaLabel(c.media);
  return (
    <li className="cv-row">
      <div className="cv-head">
        <span className="cv-author">{c.author}</span>
        {full && c.published_at && <span className="cv-age">{relTime(c.published_at)}</span>}
        <Likes n={c.likes} />
      </div>
      {c.text && <p className="cv-text">{c.text}</p>}
      {(media || (full && (c.replies > 0 || c.url))) && (
        <div className="cv-foot">
          {media && <span>{media}</span>}
          {full && c.replies > 0 && <span>{compactCount(c.replies)} {c.replies === 1 ? "reply" : "replies"}</span>}
          {full && c.url && (
            <a className="cv-link" href={c.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${c.author}'s comment`}>
              <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
            </a>
          )}
        </div>
      )}
    </li>
  );
}

/** The post this item quotes, as an inset card. */
export function QuotedPost({ c }: { c: ConversationComment }) {
  const media = mediaLabel(c.media);
  return (
    <div className="cv-quoted">
      <span className="cv-author">{c.author}</span>
      {c.text && <p className="cv-text">{c.text}</p>}
      {media && <div className="cv-foot"><span>{media}</span></div>}
    </div>
  );
}

/** "183 likes · 11 reposts · 14 replies · 1 quote" for social posts. */
export function CountsLine({ conv }: { conv: Conv }) {
  const { likes, reposts, replies, quotes } = conv.counts;
  const reply = conv.platform === "bluesky" ? ["reply", "replies"] : ["comment", "comments"];
  const repost = conv.platform === "bluesky" ? ["repost", "reposts"] : ["restack", "restacks"];
  const parts: string[] = [];
  const add = (n: number, [one, many]: string[]) => n > 0 && parts.push(`${compactCount(n)} ${n === 1 ? one : many}`);
  add(likes, ["like", "likes"]);
  add(reposts, repost);
  add(replies, reply);
  add(quotes, ["quote", "quotes"]);
  if (!parts.length) return null;
  return <div className="cv-counts">{parts.join(" · ")}</div>;
}

/**
 * The card's share of the conversation. The layout solver may hide the second
 * reply, then both (`data-solved-conv` on the stage), before it gives up the
 * excerpt; the "more" link always stays.
 */
export function CardConversation({ conv, onMore, counts = true }: { conv: Conv; onMore?: () => void; counts?: boolean }) {
  if (!hasConversation(conv)) return null;
  const top = conv.replies.slice(0, 2);
  const more = moreLabel(conv, top.length);
  const social = conv.platform !== "youtube";
  return (
    <div className="card-conv">
      {conv.quoted && <QuotedPost c={conv.quoted} />}
      {counts && social && <CountsLine conv={conv} />}
      {top.length > 0 && (
        <ol className="cv-list cv-card-replies" aria-label={social && conv.platform === "bluesky" ? "Top replies" : "Top comments"}>
          {top.map((c, i) => <CommentRow key={i} c={c} />)}
        </ol>
      )}
      {more && onMore && (
        <button
          type="button"
          className="cv-more"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onMore();
          }}
        >
          <span>{more}</span>
          <ChevronRight size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

function FullConversation({ conv, titled = true }: { conv: Conv; titled?: boolean }) {
  const bsky = conv.platform === "bluesky";
  return (
    <>
      {conv.replies.length > 0 && (
        <section className="cv-section">
          {(titled || conv.quotes.length > 0) && <h2 className="cv-heading">{bsky ? "Replies" : "Comments"}</h2>}
          <ol className="cv-list">{conv.replies.map((c, i) => <CommentRow key={i} c={c} full />)}</ol>
        </section>
      )}
      {conv.quotes.length > 0 && (
        <section className="cv-section">
          <h2 className="cv-heading">Quotes</h2>
          <ol className="cv-list">{conv.quotes.map((c, i) => <CommentRow key={i} c={c} full />)}</ol>
        </section>
      )}
      {conv.replies.length === 0 && conv.quotes.length === 0 && <p className="cv-empty">No {bsky ? "replies" : "comments"} yet.</p>}
      {conv.url && (
        <a className="reader-open cv-open" href={conv.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={15} strokeWidth={1.75} aria-hidden />
          Open on {platformName(conv.platform)}
        </a>
      )}
    </>
  );
}

/**
 * A Substack article's card (#209): its counts row (stored with the item, so it
 * shows before the conversation arrives) and its most-liked comment, which the
 * solver drops before the excerpt. The "more" link always stays.
 */
export function ArticleConversation({ item, conv, onMore }: { item: Item; conv: Conv | null; onMore?: () => void }) {
  const counts = postRowCounts(item, conv);
  const any = !!counts && counts.likes + counts.reposts + counts.replies > 0;
  const top = conv ? conv.replies.slice(0, 1) : [];
  const more = conv ? moreLabel(conv, top.length) : "";
  if (!any && !top.length && !more) return null;
  return (
    <div className="card-conv cv-article">
      {any && counts && <EngagementRow {...counts} />}
      {top.length > 0 && (
        <ol className="cv-list cv-card-replies" aria-label="Top comment">
          {top.map((c, i) => <CommentRow key={i} c={c} />)}
        </ol>
      )}
      {more && onMore && (
        <button type="button" className="cv-more" onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onMore(); }}>
          <span>{more}</span>
          <ChevronRight size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * The reader's conversation section, under an article. Bluesky and Substack get
 * the threaded, paged thread (#209); YouTube keeps its list.
 */
export function ReaderConversation({ item, onPending }: { item: Item; onPending?: (pending: boolean) => void }) {
  const { conv, status } = useConversationState(item);
  const pending = useCallback((p: boolean) => onPending?.(p), [onPending]);
  const threaded = !!conv && (conv.platform === "bluesky" || conv.platform === "substack");
  // Until the conversation is here (or for one that does not page), the reader's
  // pull waits only while it is loading.
  useEffect(() => {
    if (!threaded) onPending?.(status === "loading");
  }, [threaded, status, onPending]);
  if (conv && threaded) {
    return (
      <>
        {conv.quoted && <QuotedPost c={conv.quoted} />}
        <CountsLine conv={conv} />
        <ReaderThread conv={conv} item={item} status={status} platform={conv.platform} onPending={pending} />
      </>
    );
  }
  if (!conv) return null;
  return (
    <div className="rp-conv" id="conversation">
      {conv.quoted && <QuotedPost c={conv.quoted} />}
      <CountsLine conv={conv} />
      <FullConversation conv={conv} />
    </div>
  );
}

/** The conversation in an overlay - Shorts, and the rest of a long video's. */
export function ConversationSheet({ item, open, onClose }: { item: Item | null; open: boolean; onClose: () => void }) {
  const { conv, status } = useConversationState(item, open);
  return (
    <BottomSheet open={open} onClose={onClose} kicker={conv?.platform === "bluesky" ? "Replies" : "Comments"}>
      <div className="cv-sheet">
        {conv ? <FullConversation conv={conv} titled={false} /> : <p className="cv-empty">{status === "error" ? "Comments couldn't load." : status === "loading" ? "Loading comments…" : "No comments."}</p>}
      </div>
    </BottomSheet>
  );
}

/** The Shorts footer's comments control. Present only when there are comments. */
export function ShortsCommentsButton({ conv, onOpen }: { conv: Conv | null; onOpen: () => void }) {
  if (!conv || conv.replies.length === 0) return null;
  return (
    <button type="button" className="shorts-quiet-btn" onClick={onOpen} aria-label={`Comments, ${conv.counts.replies || conv.replies.length}`}>
      <MessageCircle size={18} strokeWidth={1.7} aria-hidden />
    </button>
  );
}

