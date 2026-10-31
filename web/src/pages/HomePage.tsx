import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Bookmark, ChevronRight, MoreHorizontal, Plus, SlidersHorizontal, X } from "lucide-react";
import { api, type Topic, type Section, type Source } from "@/api/client";
import { usePreferences } from "@/context/PreferencesContext";
import { useAuth } from "@/context/AuthContext";
import { useInstrument } from "@/components/ContextInstrument";
import { BottomSheet } from "@/components/BottomSheet";
import { HowItWorks } from "@/components/HowItWorks";
import { SavePresetDialog } from "@/components/SessionPresetPrompt";
import { contentLabel, contentTypeLabel, contentTypes, defaultSetup, initialPresets, isSavedSetup, loadSessionPresets, recordSessionSetup, repeatSuggestion, setupKey, starterPresetIds, storeSessionPresets, type SessionPreset, type SessionPresets, type SessionSetup } from "@/lib/sessionPresets";
import "@/styles/launcher.css";
import { useShortsMode } from "@/lib/shortsMode";
import { ShortsModeToggle } from "@/components/ShortsModeToggle";

export default function HomePage() {
    const nav = useNavigate();
    const { search } = useLocation();
    const sessionLink = useMemo(() => {
        const params = new URLSearchParams(search);
        return ["minutes", "sections", "content"].some((key) => params.has(key)) ? params : null;
    }, [search]);
    const { prefs } = usePreferences();
    const { user } = useAuth();
    const [shortsMode, setShortsMode] = useShortsMode();
    const [custom, setCustom] = useState(false);
    const [setup, setSetup] = useState<SessionSetup>(defaultSetup);
    const [data, setData] = useState<SessionPresets>(initialPresets);
    const [topics, setTopics] = useState<Topic[]>([]);
    const [sections, setSections] = useState<Section[]>([]);
    const [sources, setSources] = useState<Source[]>([]);
    const [activeSession, setActiveSession] = useState("");
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [sheet, setSheet] = useState<"advanced" | "presets" | "recent" | null>(null);
    const [save, setSave] = useState<{ setup: SessionSetup; preset?: SessionPreset } | null>(null);
    const accountId = user?.id;
    useEffect(() => {
        if (accountId == null || !loaded) return;
        const news = sections.find((section) => section.slug.toLowerCase() === "news" || section.name.toLowerCase() === "news");
        const refresh = () => setData(loadSessionPresets(accountId, news?.slug));
        refresh();
        window.addEventListener("otium-presets-change", refresh);
        window.addEventListener("storage", refresh);
        return () => { window.removeEventListener("otium-presets-change", refresh); window.removeEventListener("storage", refresh); };
    }, [accountId, loaded, sections]);
    useEffect(() => {
        let live = true;
        setLoadError(""); setLoaded(false);
        Promise.all([api.topics(), api.sections(), api.sources(), api.currentSession()]).then(([t, s, src, current]) => {
            if (!live) return;
            setTopics(t ?? []); setSections(s ?? []); setSources(src ?? []); setActiveSession(current?.session_id ?? ""); setLoaded(true);
            if (sessionLink) {
                const minutes = sessionLink.has("minutes") ? Number(sessionLink.get("minutes")) : 10;
                const selectedSections = (sessionLink.get("sections") ?? "").split(",").filter(Boolean);
                const selectedContent = sessionLink.has("content") ? sessionLink.get("content")!.split(",") : contentTypes;
                if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120 ||
                    selectedSections.some((slug) => !(s ?? []).some((section) => section.slug === slug)) ||
                    !selectedContent.length || selectedContent.some((type) => !contentTypes.some((allowed) => allowed === type))) {
                    setError("This session link has an unavailable section, content type or duration.");
                    setCustom(false);
                    return;
                }
                setSetup({ minutes, sections: [...new Set(selectedSections)], excluded: [], contentTypes: contentTypes.filter((type) => selectedContent.includes(type)) });
                setCustom(true);
                setError("");
                return;
            }
            try {
                const previous: unknown = JSON.parse(localStorage.getItem("otium.last-scope") ?? "[]");
                if (Array.isArray(previous)) setSetup((value) => ({ ...value, sections: (s ?? []).filter((section) => previous.includes(section.slug)).map((section) => section.slug) }));
            } catch { /* Existing scope is optional device state. */ }
        }).catch((e) => live && setLoadError(String(e.message ?? e)));
        return () => { live = false; };
    }, [loadAttempt, sessionLink]);
    const initializedMinutes = useRef(false);
    useEffect(() => {
        if (!initializedMinutes.current && prefs.presets.length) {
            initializedMinutes.current = true;
            if (!sessionLink) setSetup((value) => ({ ...value, minutes: prefs.presets[Math.min(1, prefs.presets.length - 1)] }));
        }
    }, [prefs.presets, sessionLink]);
    const scopedTopics = useMemo(() => topics.filter((topic) => !setup.sections.length || setup.sections.includes(topic.section_slug ?? "")), [topics, setup.sections]);
    const defaultPreset = data.presets.find((preset) => preset.id === data.defaultId) ?? data.presets[0];
    const homePresets = [defaultPreset, ...starterPresetIds.map((id) => data.presets.find((preset) => preset.id === id))]
        .filter((preset, index, all): preset is SessionPreset => !!preset && all.findIndex((entry) => entry?.id === preset.id) === index);
    const recent = data.recent.filter((value) => !isSavedSetup(data, value));
    const suggestion = repeatSuggestion(data);
    function scopeLabel(value: SessionSetup) {
        return value.sections.length ? value.sections.map((slug) => sections.find((section) => section.slug === slug)?.name ?? "Unavailable section").join(" + ") : "Everything";
    }
    function setupLabel(value: SessionSetup) {
        return `${value.minutes} min · ${contentLabel(value)} · ${scopeLabel(value)}${value.excluded.length ? ` · ${value.excluded.length} topics excluded` : ""}`;
    }
    function hasSupply(value: SessionSetup) {
        const kept = topics.filter((topic) => (!value.sections.length || value.sections.includes(topic.section_slug ?? "")) && !value.excluded.includes(topic.slug));
        const scope = sources.filter((source) => !value.sections.length && !value.excluded.length || kept.some((topic) => topic.slug === source.topic_slug));
        // Counts are per source, not per media type. The server resolves exact
        // media eligibility; using source kinds here would hide mixed RSS media.
        return scope.some((source) => (source.unseen_count ?? 0) > 0);
    }
    function invalidSetup(value: SessionSetup) {
        return value.sections.some((slug) => !sections.some((section) => section.slug === slug)) ||
            value.excluded.length > 0 && !topics.some((topic) => (!value.sections.length || value.sections.includes(topic.section_slug ?? "")) && !value.excluded.includes(topic.slug));
    }
    async function begin(value: SessionSetup) {
        if (busy || accountId == null) return;
        if (!value.contentTypes.length) { setError("Choose at least one content type."); return; }
        if (invalidSetup(value)) { setError("This setup has no available topics. Edit the session scope."); return; }
        setBusy(true); setError("");
        try {
            const themes = value.excluded.length ? topics.filter((topic) => (!value.sections.length || value.sections.includes(topic.section_slug ?? "")) && !value.excluded.includes(topic.slug)).map((topic) => topic.slug) : [];
            const response = await api.createSession(value.minutes, themes, value.excluded.length ? [] : value.sections, value.contentTypes);
            if (!response?.session_id) { setError("No new items match this session. Change the scope or content types."); return; }
            recordSessionSetup(accountId, response.session_id, value);
            try { localStorage.setItem("otium.last-scope", JSON.stringify(value.sections)); } catch { /* Storage is optional. */ }
            nav(`/session/${response.session_id}`);
        } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
    }
    function updateData(next: SessionPresets) {
        if (accountId != null && !storeSessionPresets(accountId, next)) setError("Couldn't save this change. Check browser storage and retry.");
    }
    useInstrument(custom && loaded && sources.length > 0 ? {
        eyebrow: "Custom session", label: `${setup.minutes} min · ${contentLabel(setup)}`,
        onMenu: () => setCustom(false), menuLabel: "Back to sessions", leadingIcon: <ArrowLeft size={20}/>,
        action: { label: busy ? "Gathering…" : "Start", onClick: () => { void begin(setup); }, icon: <ArrowRight size={18}/>, disabled: busy || !setup.contentTypes.length || !hasSupply(setup) || invalidSetup(setup) },
    } : activeSession && loaded ? {
        eyebrow: "Session in progress", label: "Return to session",
        onMenu: () => window.dispatchEvent(new CustomEvent("otium:app-menu")), menuLabel: "App menu",
        onLabel: () => nav(`/session/${activeSession}`),
        action: { label: "Resume", onClick: () => nav(`/session/${activeSession}`), icon: <ArrowRight size={18}/> },
    } : null);
    const press = useRef<{ id: number; x: number; y: number; axis: string } | null>(null);
    function pointerDown(event: ReactPointerEvent) {
        press.current = null;
        if (event.isPrimary && event.button === 0 && (window.visualViewport?.scale ?? 1) <= 1 && !(event.target as HTMLElement).closest("button,input,select,a,label")) press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: "" };
    }
    function pointerMove(event: ReactPointerEvent) {
        const p = press.current;
        if (!p || p.id !== event.pointerId || p.axis) return;
        const dx = Math.abs(event.clientX - p.x), dy = Math.abs(event.clientY - p.y);
        if (Math.max(dx, dy) > 12) p.axis = dx > dy * 1.4 ? "x" : "y";
    }
    function pointerUp(event: ReactPointerEvent) {
        const p = press.current; press.current = null;
        if (p && p.id === event.pointerId && p.axis === "x" && event.clientX - p.x > 70 && custom) setCustom(false);
    }
    if (loadError) return <section className="launcher"><h1>Couldn't load your library</h1><p role="alert">{loadError}</p><button className="btn" onClick={() => setLoadAttempt((n) => n + 1)}>Retry</button></section>;
    if (!loaded) return <section className="launcher"><p role="status">Loading your library…</p></section>;
    if (!sources.length) return <section className="launcher"><h1>Add your first source</h1><p>Follow RSS feeds, YouTube channels or podcasts to build a session.</p><button className="btn" onClick={() => nav("/sections")}>Go to Library</button><HowItWorks defaultOpen/></section>;
    return <section className={`launcher ${custom ? "launcher-custom" : ""}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { press.current = null; }}>
        <header className="launcher-head"><h1>{custom ? "Custom session" : "New session"}</h1></header>
        {error && <p className="launcher-error" role="alert">{error}</p>}
        {!custom ? <>
            <div className="launcher-starters">
                {homePresets.map((preset) => <div className={`launcher-starter ${preset.id === data.defaultId ? "is-default" : ""}`} key={preset.id}>
                    <button className="launcher-starter-start" aria-label={`Start ${preset.name}`} disabled={busy || !hasSupply(preset.setup) || invalidSetup(preset.setup)} onClick={() => begin(preset.setup)}>
                        <span><strong>{preset.name}</strong><small>{preset.setup.minutes} min · {scopeLabel(preset.setup)}</small></span><ArrowRight size={21}/>
                    </button>
                    <button className="launcher-starter-edit" aria-label={`Customize ${preset.name}`} onClick={() => { setError(""); setSetup(preset.setup); setCustom(true); }}><SlidersHorizontal size={19}/></button>
                </div>)}
            </div>
            <div className="launcher-secondary">
                <button className="launcher-custom-action" onClick={() => { setError(""); setCustom(true); }}><Plus size={19}/><span>Custom session</span></button>
                <button className="launcher-manage" aria-label="Manage presets" onClick={() => setSheet("presets")}><MoreHorizontal size={19}/>Presets</button>
                {recent.length > 0 && <button className="launcher-manage" aria-label="Recent sessions" onClick={() => setSheet("recent")}>Recent</button>}
            </div>
            {!sources.some((source) => (source.unseen_count ?? 0) > 0) && <p className="launcher-meta">No new items. Add or refresh sources in Library.</p>}
        </> : <>
            <fieldset className="launcher-group"><legend>Duration</legend><div className="launcher-options">{prefs.presets.slice(0, 4).map((minutes) => <button key={minutes} aria-pressed={setup.minutes === minutes} onClick={() => setSetup({ ...setup, minutes })}>{minutes} min</button>)}</div><label className="launcher-duration">Minutes<input type="number" min={5} max={120} value={setup.minutes} onChange={(event) => setSetup({ ...setup, minutes: Math.round(Math.max(5, Math.min(120, Number(event.target.value) || 5))) })}/></label></fieldset>
            <label className="launcher-field">Scope<select value={setup.sections.length === 0 ? "" : setup.sections.length === 1 ? setup.sections[0] : "__multiple"} onChange={(event) => setSetup({ ...setup, sections: event.target.value ? [event.target.value] : [], excluded: [] })}><option value="">Everything</option>{sections.map((section) => <option key={section.slug} value={section.slug}>{section.name}</option>)}{setup.sections.length > 1 && <option value="__multiple">{setup.sections.length} sections</option>}</select></label>
            <fieldset className="launcher-group" aria-describedby="content-types-help"><legend>Content</legend><div className="launcher-options launcher-content-options">{contentTypes.map((type) => <button key={type} aria-pressed={setup.contentTypes.includes(type)} onClick={() => setSetup({ ...setup, contentTypes: contentTypes.filter((candidate) => candidate === type ? !setup.contentTypes.includes(type) : setup.contentTypes.includes(candidate)) })}>{contentTypeLabel[type]}</button>)}</div><p id="content-types-help" className="launcher-meta">{setup.contentTypes.length ? "Articles includes audio. Choose any combination." : "Choose at least one content type."}</p></fieldset>
            {setup.contentTypes.includes("short") && <ShortsModeToggle enabled={shortsMode} onChange={setShortsMode} />}
            <div className="launcher-custom-actions"><button className="launcher-advanced" onClick={() => setSheet("advanced")}><SlidersHorizontal size={17}/>Topics and sections<ChevronRight size={17}/></button>
            <button className="launcher-save-link" disabled={!setup.contentTypes.length} onClick={() => setSave({ setup })}><Bookmark size={16}/>Save preset</button></div>
            {!hasSupply(setup) && <p className="launcher-meta">No new items in this scope.</p>}
        </>}
        {sheet && <BottomSheet open kicker={sheet === "advanced" ? "Session options" : sheet === "recent" ? "Recent sessions" : "Presets"} onClose={() => setSheet(null)}><div className="launcher-sheet-body">
            {sheet === "advanced" ? <>
                <h3>Sections</h3><label className="launcher-check"><input type="checkbox" checked={!setup.sections.length} onChange={() => setSetup({ ...setup, sections: [], excluded: [] })}/>Everything</label>
                {sections.map((section) => <label className="launcher-check" key={section.slug}><input type="checkbox" checked={setup.sections.includes(section.slug)} onChange={() => setSetup({ ...setup, sections: setup.sections.includes(section.slug) ? setup.sections.filter((slug) => slug !== section.slug) : [...setup.sections, section.slug], excluded: [] })}/>{section.name}</label>)}
                <h3>Topics</h3>{scopedTopics.map((topic) => <label className="launcher-check" key={topic.slug}><input type="checkbox" checked={!setup.excluded.includes(topic.slug)} onChange={() => setSetup({ ...setup, excluded: setup.excluded.includes(topic.slug) ? setup.excluded.filter((slug) => slug !== topic.slug) : [...setup.excluded, topic.slug] })}/>{topic.name}</label>)}
                <button className="btn" onClick={() => setSheet(null)}>Done</button>
            </> : sheet === "presets" ? <><p className="launcher-meta">Saved on this device for your account.</p>{data.presets.map((preset) => <div className="launcher-preset" key={preset.id}><button className="launcher-row" disabled={busy || !hasSupply(preset.setup) || invalidSetup(preset.setup)} onClick={() => begin(preset.setup)}><span><strong>{preset.name}{preset.id === data.defaultId ? " · Default" : ""}</strong><small>{setupLabel(preset.setup)}</small></span><ArrowRight size={18}/></button><div className="launcher-preset-actions"><button onClick={() => { setSheet(null); setSetup(preset.setup); setCustom(true); }}>Customize</button><button onClick={() => setSave({ setup: preset.setup, preset })}>Rename</button>{preset.id !== data.defaultId && <button onClick={() => updateData({ ...data, defaultId: preset.id })}>Make default</button>}<button onClick={() => updateData({ ...data, presets: data.presets.filter((p) => p.id !== preset.id), defaultId: data.defaultId === preset.id ? data.presets.find((p) => p.id !== preset.id)?.id ?? "" : data.defaultId })}>Remove</button></div></div>)}<button className="btn" onClick={() => { setSheet(null); setCustom(true); }}>Custom session</button></> : <>{suggestion && <div className="launcher-suggestion"><button onClick={() => setSave({ setup: suggestion })}>Used twice. Save as preset?</button><button className="icon-btn" aria-label="Dismiss preset suggestion" onClick={() => updateData({ ...data, dismissed: [...data.dismissed, setupKey(suggestion)] })}><X size={16}/></button></div>}{recent.length ? recent.map((value) => <div className="launcher-recent" key={setupKey(value)}><button className="launcher-row" onClick={() => { setSheet(null); setSetup(value); setCustom(true); }}><span><strong>{value.minutes} min {contentLabel(value).toLowerCase()}</strong><small>{setupLabel(value)}</small></span><ChevronRight size={18}/></button><button className="icon-btn" aria-label={`Save ${value.minutes} minute session as preset`} onClick={() => setSave({ setup: value })}><Bookmark size={18}/></button></div>) : <p>No unsaved sessions.</p>}</>}
        </div></BottomSheet>}
        {save && <SavePresetDialog setup={save.setup} name={save.preset?.name} editId={save.preset?.id} onClose={() => setSave(null)}/>}
    </section>;
}
