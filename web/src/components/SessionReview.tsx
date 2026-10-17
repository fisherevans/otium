import { ArrowLeft, Bookmark, ExternalLink } from "lucide-react";
import type { Selected } from "@/api/client";
import { ContextInstrument } from "./ContextInstrument";
import { Overlay } from "./Overlay";

export interface SessionReviewData {
    items: Selected[];
    opened: number[];
    played: number[];
    skipped: number[];
    skips: number;
    activeSeconds: number;
    awaySeconds: number;
    reading: { read: number; video: number; audio: number };
    sources: number;
    cursor: number;
    duration: number;
}

export function sessionTime(seconds: number) {
    const value = Math.max(0, Math.floor(seconds));
    return value < 60 ? `${value} sec` : `${Math.floor(value / 60)} min${value % 60 ? ` ${value % 60} sec` : ""}`;
}

export function SessionReview({ review, onClose, onRead, onSave, saved }: {
    review: SessionReviewData;
    onClose: () => void;
    onRead: (item: Selected) => void;
    onSave: (item: Selected) => void;
    saved: Record<number, boolean>;
}) {
    const opened = review.items.filter(({ item }) => review.opened.includes(item.id));
    const videos = review.items.filter(({ item }) => review.played.includes(item.id) && ["short", "long", "live"].includes(item.media_type)).length;
    const audio = review.items.filter(({ item }) => review.played.includes(item.id) && item.media_type === "audio").length;
    const stats = [
        ["Shown", review.items.length],
        ["Articles opened", opened.filter(({ item }) => !["short", "long", "live", "audio"].includes(item.media_type)).length],
        ...(videos ? [["Videos played", videos]] : []),
        ...(audio ? [["Audio played", audio]] : []),
        ["Skips", review.skips],
        ["Time spent", sessionTime(review.activeSeconds)],
    ];
    return <Overlay label="Review session" onClose={onClose}>
        <section className="session-review-page">
            <div className="session-review-scroll">
                <h1>Review session</h1>
                <dl className="session-review-stats">
                    {stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
                <details className="session-review-details">
                    <summary>About these stats</summary>
                    <p>Articles opened counts articles opened in the reader or at their source. Skips counts forward passes without opening, playing or saving. Time spent excludes time this tab was hidden. Reviewing this list does not change these totals.</p>
                    <dl>
                        <div><dt>Sources shown</dt><dd>{review.sources}</dd></div>
                        <div><dt>Reading in app</dt><dd>{sessionTime(review.reading.read / 1000)}</dd></div>
                        {videos > 0 && <div><dt>Video in app</dt><dd>{sessionTime(review.reading.video / 1000)}</dd></div>}
                        {audio > 0 && <div><dt>Audio in app</dt><dd>{sessionTime(review.reading.audio / 1000)}</dd></div>}
                        <div><dt>Browsing</dt><dd>{sessionTime(Math.max(0, review.activeSeconds - Object.values(review.reading).reduce((a, b) => a + b, 0) / 1000))}</dd></div>
                        <div><dt>Time away</dt><dd>{sessionTime(review.awaySeconds)}</dd></div>
                        <div><dt>Total session</dt><dd>{sessionTime(review.activeSeconds + review.awaySeconds)}</dd></div>
                    </dl>
                </details>
                <div className="session-review-list">
                    {review.items.map((sel) => {
                        const { item } = sel;
                        const media = ["short", "long", "live", "audio"].includes(item.media_type);
                        const status = media && review.played.includes(item.id) ? "Played" : review.opened.includes(item.id) ? "Opened" : review.skipped.includes(item.id) ? "Skipped" : "Shown";
                        return <article className="session-review-item" key={item.id}>
                            <button className="session-review-open" onClick={() => onRead(sel)}>
                                {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="session-review-placeholder"><ExternalLink size={18} aria-hidden /></span>}
                                <span><small>{sel.source_title} · {status}</small><strong>{item.title}</strong></span>
                            </button>
                            <button className="session-review-bookmark" onClick={() => onSave(sel)} aria-pressed={!!saved[item.id]} aria-label={`Save to collection: ${item.title}`}>
                                <Bookmark size={21} fill={saved[item.id] ? "currentColor" : "none"} strokeWidth={1.7} aria-hidden />
                            </button>
                        </article>;
                    })}
                </div>
            </div>
            <ContextInstrument mode="app" eyebrow="Session review" label={`${review.items.length} items shown`} action={{ label: "Done", onClick: onClose, icon: <ArrowLeft size={17} /> }} />
        </section>
    </Overlay>;
}
