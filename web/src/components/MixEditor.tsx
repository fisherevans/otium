import { ChevronRight, SlidersHorizontal } from "lucide-react";
import type { MixFormat, Section, SessionMix } from "@/api/client";
import { mixFormatLabel, mixFormats, mixPercents, sectionWeights } from "@/lib/sessionPresets";
import "@/styles/mix.css";

// The mix editor (#201): one row per format with a slider and its share of
// session time, and a summary row that opens the section weights. Shares are
// relative values; the percentages are what the engine aims for.
export function MixFormats({ mix, onChange }: { mix: SessionMix; onChange: (mix: SessionMix) => void }) {
    const pct = mixPercents(mix);
    const set = (format: MixFormat, value: number) => onChange({ ...mix, formats: { ...mix.formats, [format]: value } });
    return <fieldset className="launcher-group mix-formats" aria-describedby="mix-formats-help">
        <legend>Share of session time</legend>
        <div className="mix-bar" aria-hidden>{mixFormats.filter((f) => pct[f] > 0).map((f) => <span key={f} className={`mix-bar-${f}`} style={{ flexGrow: pct[f] }} />)}</div>
        {mixFormats.map((format) => <label className="mix-row" key={format}>
            <span className={`mix-swatch mix-bar-${format}`} aria-hidden />
            <span className="mix-name">{mixFormatLabel[format]}</span>
            <input type="range" min={0} max={100} step={5} value={mix.formats[format] ?? 0} aria-valuetext={`${pct[format]}% of session time`} onChange={(event) => set(format, Number(event.target.value))} />
            <output className="mix-pct">{pct[format] ? `${pct[format]}%` : "Off"}</output>
        </label>)}
        <p id="mix-formats-help" className="launcher-meta">{mixFormats.some((f) => pct[f] > 0) ? "Long videos count by length. Posts are Bluesky items." : "Give at least one format a share."}</p>
    </fieldset>;
}

export function sectionsSummary(mix: SessionMix, sections: Section[]): string {
    const changed = sections.filter((section) => (mix.sections[section.slug] ?? 1) !== 1);
    if (!changed.length) return "All sections even";
    const word = (slug: string) => sectionWeights.find((w) => w.value === (mix.sections[slug] ?? 1))?.label.toLowerCase() ?? "even";
    if (changed.length > 2) return `${changed.length} sections adjusted`;
    return changed.map((section) => `${section.name} ${word(section.slug)}`).join(" · ");
}

export function MixSectionsRow({ mix, sections, onOpen }: { mix: SessionMix; sections: Section[]; onOpen: () => void }) {
    return <button className="launcher-advanced mix-sections-row" onClick={onOpen}><SlidersHorizontal size={17}/>Sections<span className="mix-sections-summary">{sectionsSummary(mix, sections)}</span><ChevronRight size={17}/></button>;
}

// Section weights, one segmented control per section (the same segment style as
// Representation). Even is the default; Off leaves the section out.
export function MixSections({ mix, sections, onChange }: { mix: SessionMix; sections: Section[]; onChange: (mix: SessionMix) => void }) {
    const set = (slug: string, value: number) => {
        const next = { ...mix.sections };
        if (value === 1) delete next[slug]; else next[slug] = value;
        onChange({ ...mix, sections: next });
    };
    return <div className="mix-sections">
        <p className="launcher-meta">More picks a section's sources more often within each format.</p>
        {sections.map((section) => {
            const value = mix.sections[section.slug] ?? 1;
            return <div className="mix-section" key={section.slug}>
                <span className="mix-section-name" id={`mix-section-${section.slug}`}>{section.name}</span>
                <div className="rep-scale" role="group" aria-labelledby={`mix-section-${section.slug}`}>
                    {sectionWeights.map((w) => <button key={w.label} type="button" aria-pressed={value === w.value} className={`rep-seg ${value === w.value ? "on" : ""}`} onClick={() => set(section.slug, w.value)}>{w.label}</button>)}
                </div>
            </div>;
        })}
    </div>;
}
