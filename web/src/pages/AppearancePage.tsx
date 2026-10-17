import { useEffect, useId, useRef, useState } from "react";
import type { FontKey, InkKey, Selected } from "@/api/client";
import { useBack } from "@/lib/navigation";
import { SessionCard } from "@/components/SessionCard";
import { usePreferences, prefsToVars, FONT_STACKS } from "@/context/PreferencesContext";
import { cardVars, SHIPPED_LAYOUT, SHIPPED_VARS, solveWhenReady } from "@/lib/cardLayout";

const HERO = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#e8b04b"/><stop offset="1" stop-color="#d76a5a"/></linearGradient></defs><rect width="640" height="360" fill="url(#sky)"/><circle cx="464" cy="116" r="60" fill="#f6e7c8"/><path d="M0 300L140 208L256 276L392 184L520 264L640 200V360H0Z" fill="#4a5a53"/><path d="M0 336L168 264L300 320L440 256L640 316V360H0Z" fill="#2f3a37"/></svg>`);
const SAMPLE: Selected = {
    item: {
        id: -1, source_id: -1, url: "https://example.org/reading", title: "How migratory birds navigate at night",
        summary: "Researchers study how birds combine starlight, magnetic fields and familiar landmarks during migration.",
        content: "<p>A sample article.</p>", content_source: "rss", author: "A. Writer", thumbnail_url: HERO,
        media_type: "article", duration_sec: 0, aspect_ratio: 0,
        published_at: new Date(Date.now() - 2 * 86400000).toISOString(), fetched_at: "",
    },
    source_title: "The Reader", topic: { name: "Essays", slug: "essays", color: "#6b7f6b", icon: "" },
    score: 1, est_duration_sec: 300, reason: "",
    breakdown: { weight: 1, rarity: 1, freshness: 1, effective_score: 1, cadence_per_day: 1, age_days: 2 },
};

function Choice<T extends string | number>({ label, value, options, onChange }: {
    label: string; value: T; options: { label: string; value: T }[]; onChange: (value: T) => void;
}) {
    return <fieldset className="appearance-choice"><legend>{label}</legend><div className="appearance-options">
        {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div></fieldset>;
}

function Slider({ label, value, min, max, step = 1, unit = "", onChange }: {
    label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void;
}) {
    const id = useId();
    return <div className="appearance-slider"><label htmlFor={id}>{label} <output>{value}{unit}</output></label>
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>;
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
    return <label className="appearance-toggle"><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />{label}</label>;
}

function Ink({ label, value, onChange }: { label: string; value: InkKey; onChange: (value: InkKey) => void }) {
    return <Choice label={label} value={value} onChange={onChange} options={[
        { label: "Ink", value: "ink" }, { label: "Graphite", value: "graphite" },
        { label: "Soft", value: "soft" }, { label: "Muted", value: "mute" },
    ]} />;
}

function CardPreview({ long }: { long: boolean }) {
    const { prefs, presentation } = usePreferences();
    const frame = useRef<HTMLDivElement>(null);
    const card = useRef<HTMLDivElement>(null);
    const sample = { ...SAMPLE, item: { ...SAMPLE.item, title: long
        ? "How migratory birds find their way across thousands of miles using stars, magnetic fields and familiar landmarks"
        : SAMPLE.item.title } };
    useEffect(() => {
        const box = frame.current;
        const el = card.current;
        if (!box || !el) return;
        let cancel = () => {};
        const solve = () => {
            cancel();
            cancel = solveWhenReady(box, box, el, SHIPPED_LAYOUT);
        };
        const observer = new ResizeObserver(solve);
        observer.observe(box);
        solve();
        return () => { cancel(); observer.disconnect(); };
    }, [prefs, presentation, long]);
    const noop = () => {};
    return <div className="appearance-card-frame stage" ref={frame} style={cardVars(SHIPPED_VARS)} inert>
        <SessionCard ref={card} sel={sample} index={0} focused render="full_text" hierarchy="taxonomy-credit"
            sectionName="Reading" menuPlacement="actions" onOpenContent={noop} onOpenExternal={noop}
            onSave={noop} onSource={noop} onMenu={noop} />
    </div>;
}

function ReaderPreview() {
    return <div className="appearance-reader-frame readerpage-body" tabIndex={0} role="region" aria-label="Reader preview">
        <h1 className="rp-title">{SAMPLE.item.title}</h1>
        <div className="rp-meta"><span>The Reader</span><span>·</span><span>A. Writer</span></div>
        <div className="reader-body">
            <p>Many migratory birds travel at night. Cooler air reduces the energy needed for flight, while the stars provide a reference for navigation.</p>
            <img src={HERO} alt="Illustrated hills beneath a golden sky" />
            <p>Researchers can test these navigation systems by changing the light or magnetic field around birds in controlled conditions.</p>
        </div>
    </div>;
}

export default function AppearancePage() {
    const back = useBack("/you");
    const { prefs, update, loaded, loadError, saveStatus, retry, presentation, setPresentation, presentationError, reducedMotion } = usePreferences();
    const [surface, setSurface] = useState<"reader" | "card">("reader");
    const [long, setLong] = useState(false);
    const fontId = useId();
    const error = loadError || saveStatus === "error";
    return <div className="appearance appearance-page">
        <button className="lib-back" onClick={back}><span aria-hidden>←</span> Back</button>
        <h1 className="appearance-title">Appearance</h1>
        <div className="appearance-save" role={error ? "alert" : "status"}>
            {!loaded ? "Loading preferences..." : loadError ? "Saved preferences could not be loaded. Your edits stay here." :
                saveStatus === "error" ? "Changes could not be saved. Your edits stay here until you leave the app." :
                saveStatus === "saved" ? "Account preferences saved" : "Saving account preferences..."}
            {error && <button className="btn ghost" onClick={retry}>Retry</button>}
        </div>
        <section className="appearance-section" aria-labelledby="device-presentation">
            <h2 id="device-presentation">This device</h2>
            <Choice label="Presentation" value={presentation} onChange={setPresentation} options={[
                { label: "Standard", value: "standard" }, { label: "E-ink", value: "eink" },
            ]} />
            <p className="appearance-note">Standard uses your image color preference and short transitions. E-ink uses grayscale images and minimal motion. This choice stays in this browser.</p>
            {reducedMotion && <p className="appearance-note">Your device requests reduced motion. Transitions are minimized in both presentations.</p>}
            {presentationError && <p role="alert">This browser could not store the device choice. It will apply until you reload.</p>}
        </section>
        <section className="appearance-section">
            <h2>Reading preferences</h2>
            <p className="appearance-note">These settings follow your account across devices.</p>
            <Choice label="Customize" value={surface} onChange={setSurface} options={[
                { label: "Reader", value: "reader" }, { label: "Session card", value: "card" },
            ]} />
            <details className="appearance-preview" open>
                <summary>Live preview</summary>
                <p className="appearance-note">Sample content, using the same {surface === "card" ? "card and layout rules as your session" : "body styles as the article reader"}.</p>
                {surface === "card" && <Toggle label="Long headline" value={long} onChange={setLong} />}
                <div style={prefsToVars(prefs)}>{surface === "card" ? <CardPreview long={long} /> : <ReaderPreview />}</div>
            </details>
            {surface === "reader" ? <div className="appearance-controls">
                <Slider label="Text size" value={prefs.reader.font_size} min={13} max={24} unit=" px" onChange={font_size => update({ reader: { font_size } })} />
                <label className="appearance-select" htmlFor={fontId}>Font
                    <select id={fontId} value={prefs.reader.font_family} onChange={e => update({ reader: { font_family: e.target.value as FontKey } })}>
                        {(["newsreader", "charter", "book", "didot", "grotesk"] as const).map(font => <option key={font} value={font} style={{ fontFamily: FONT_STACKS[font] }}>
                            {{ newsreader: "Newsreader", charter: "Charter", book: "Iowan", didot: "Didot", grotesk: "Grotesk" }[font]}</option>)}
                    </select>
                </label>
                <Toggle label="Show images in articles" value={prefs.reader.images} onChange={images => update({ reader: { images } })} />
                <details className="appearance-advanced"><summary>More reader options</summary>
                    <Slider label="Line spacing" value={prefs.reader.line_height} min={1.2} max={2.2} step={0.02} onChange={line_height => update({ reader: { line_height } })} />
                    <Slider label="Maximum line length" value={prefs.reader.measure} min={28} max={90} unit=" characters" onChange={measure => update({ reader: { measure } })} />
                    <p className="appearance-note">Narrow screens may already be shorter than this limit.</p>
                    <Slider label="Font weight" value={prefs.reader.font_weight} min={300} max={700} step={100} onChange={font_weight => update({ reader: { font_weight } })} />
                    <Ink label="Text ink" value={prefs.reader.ink} onChange={ink => update({ reader: { ink } })} />
                </details>
            </div> : <div className="appearance-controls">
                <Toggle label="Show lead images on cards" value={prefs.card.hero_show} onChange={hero_show => update({ card: { hero_show } })} />
                <details className="appearance-advanced"><summary>Card text options</summary>
                    <h3>Section and topic</h3>
                    <Slider label="Taxonomy size" value={prefs.card.topic_tag_size} min={11} max={18} unit=" px" onChange={topic_tag_size => update({ card: { topic_tag_size } })} />
                    <Slider label="Taxonomy weight" value={prefs.card.topic_weight} min={300} max={700} step={100} onChange={topic_weight => update({ card: { topic_weight } })} />
                    <Choice label="Taxonomy ink" value={prefs.card.topic_ink} onChange={topic_ink => update({ card: { topic_ink } })} options={[
                        { label: "Default", value: "topic" }, { label: "Ink", value: "ink" }, { label: "Soft", value: "soft" }, { label: "Muted", value: "mute" },
                    ]} />
                    <h3>Source credit</h3>
                    <Slider label="Source size" value={prefs.card.source_size} min={8} max={16} unit=" px" onChange={source_size => update({ card: { source_size } })} />
                    <Slider label="Source weight" value={prefs.card.source_weight} min={300} max={700} step={100} onChange={source_weight => update({ card: { source_weight } })} />
                    <Ink label="Source ink" value={prefs.card.source_ink} onChange={source_ink => update({ card: { source_ink } })} />
                    <h3>Published date</h3>
                    <Slider label="Date size" value={prefs.card.date_size} min={11} max={18} unit=" px" onChange={date_size => update({ card: { date_size } })} />
                    <Slider label="Date weight" value={prefs.card.date_weight} min={300} max={700} step={100} onChange={date_weight => update({ card: { date_weight } })} />
                    <Ink label="Date ink" value={prefs.card.date_ink} onChange={date_ink => update({ card: { date_ink } })} />
                </details>
            </div>}
            <Choice label="Image color" value={prefs.card.hero_color ? "color" : "grayscale"} onChange={value => update({ card: { hero_color: value === "color" } })} options={[
                { label: "Natural color", value: "color" }, { label: "Grayscale", value: "grayscale" },
            ]} />
            <p className="appearance-note">Applies to article and card images. {presentation === "eink" ? "E-ink presentation uses grayscale on this device regardless of this account preference." : "Your existing image preference is preserved."}</p>
        </section>
        <details className="appearance-advanced appearance-section"><summary>Session lengths</summary>
            <p className="appearance-note">Starting lengths on Read, in minutes. Changes apply to your account.</p>
            <div className="appearance-presets">{prefs.presets.map((minutes, index) => <div key={minutes}>
                <label>Length {index + 1}<input type="number" min={5} max={120} step={5} required defaultValue={minutes} onBlur={e => {
                    if (!e.currentTarget.checkValidity()) {
                        e.currentTarget.reportValidity();
                        return;
                    }
                    const value = Number(e.currentTarget.value);
                    const presets = [...prefs.presets];
                    presets[index] = value;
                    update({ presets: [...new Set(presets)].sort((a, b) => a - b) });
                }} /></label>
                <button type="button" disabled={prefs.presets.length <= 1} aria-label={`Remove ${minutes} minute length`}
                    onClick={() => update({ presets: prefs.presets.filter((_, i) => i !== index) })}>Remove</button>
            </div>)}</div>
            <button className="btn ghost" disabled={prefs.presets.length >= 8} onClick={() => {
                const next = Array.from({ length: 24 }, (_, i) => (i + 1) * 5).find(value => !prefs.presets.includes(value));
                if (next) update({ presets: [...prefs.presets, next].sort((a, b) => a - b) });
            }}>Add a length</button>
        </details>
    </div>;
}
