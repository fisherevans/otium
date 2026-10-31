import type { SessionContentType } from "@/api/client";

export const contentTypes: SessionContentType[] = ["article", "long", "short"];
export const contentTypeLabel: Record<SessionContentType, string> = { article: "Articles", long: "Long videos", short: "Short videos" };
export interface SessionSetup {
    minutes: number;
    sections: string[];
    excluded: string[];
    contentTypes: SessionContentType[];
}
export interface SessionPreset { id: string; name: string; setup: SessionSetup }
export interface SessionPresets {
    starterVersion: number;
    newsSectionPending: boolean;
    presets: SessionPreset[];
    defaultId: string;
    recent: SessionSetup[];
    lastKey: string;
    consecutive: number;
    dismissed: string[];
    sessions: Record<string, SessionSetup>;
}
const prefix = "otium.session-presets.v1.";
const starterVersion = 2;
export const starterPresetIds = ["news", "shorts", "long-videos"] as const;
export const defaultSetup = (): SessionSetup => ({ minutes: 10, sections: [], excluded: [], contentTypes: [...contentTypes] });
export function contentLabel(setup: SessionSetup): string {
    const selected = contentTypes.filter((type) => setup.contentTypes.includes(type));
    if (selected.length === 3) return "All content";
    if (!selected.length) return "Choose content";
    return selected.map((type, index) => index ? contentTypeLabel[type].toLowerCase() : contentTypeLabel[type]).join(" + ");
}
export function setupKey(setup: SessionSetup): string {
    return JSON.stringify([setup.minutes, [...setup.sections].sort(), [...setup.excluded].sort(), contentTypes.filter((type) => setup.contentTypes.includes(type))]);
}
function normalizeSetup(value: unknown): SessionSetup | null {
    if (!value || typeof value !== "object") return null;
    const s = value as Omit<SessionSetup, "contentTypes"> & { contentTypes?: SessionContentType[]; media?: string; includeShorts?: boolean };
    if (!(Number.isInteger(s.minutes) && s.minutes >= 5 && s.minutes <= 120 &&
        Array.isArray(s.sections) && s.sections.every((v) => typeof v === "string") &&
        Array.isArray(s.excluded) && s.excluded.every((v) => typeof v === "string"))) return null;
    let selected: SessionContentType[];
    if ("contentTypes" in s) {
        if (!Array.isArray(s.contentTypes) || !s.contentTypes.length || s.contentTypes.some((v) => !contentTypes.includes(v))) return null;
        selected = contentTypes.filter((type) => s.contentTypes!.includes(type));
    } else {
        if (!["all", "read", "video", "audio"].includes(s.media ?? "") || typeof s.includeShorts !== "boolean") return null;
        // Articles now includes every non-video item, including audio.
        selected = s.media === "read" || s.media === "audio" ? ["article"] :
            contentTypes.filter((type) => (s.media === "all" || type !== "article") && (s.includeShorts || type !== "short"));
    }
    return { minutes: s.minutes, sections: s.sections, excluded: s.excluded, contentTypes: selected };
}
function normalizeKey(value: unknown): string {
    if (typeof value !== "string") return "";
    try {
        const [minutes, sections, excluded, media, includeShorts] = JSON.parse(value);
        const setup = normalizeSetup({ minutes, sections, excluded, ...(Array.isArray(media) ? { contentTypes: media } : { media, includeShorts }) });
        return setup ? setupKey(setup) : "";
    } catch { return ""; }
}
export function initialPresets(newsSectionSlug?: string): SessionPresets {
    return {
        starterVersion,
        newsSectionPending: false,
        presets: [
            { id: "news", name: "News", setup: { ...defaultSetup(), sections: newsSectionSlug ? [newsSectionSlug] : [], contentTypes: ["article"] } },
            { id: "shorts", name: "Shorts", setup: { ...defaultSetup(), contentTypes: ["short"] } },
            { id: "long-videos", name: "Long videos", setup: { ...defaultSetup(), minutes: 40, contentTypes: ["long"] } },
        ],
        defaultId: "news", recent: [], lastKey: "", consecutive: 0, dismissed: [], sessions: {},
    };
}
function rememberMigration(accountId: number, data: SessionPresets): SessionPresets {
    // Loading must not dispatch the change event that asks subscribers to reload.
    try { localStorage.setItem(prefix + accountId, JSON.stringify(data)); }
    catch { /* Keep the migrated choices usable when browser storage is full. */ }
    return data;
}
function migrateStarters(data: SessionPresets, newsSectionSlug: string | undefined, sectionsLoaded: boolean): SessionPresets {
    const starters = initialPresets(newsSectionSlug).presets;
    const oldStocks: SessionPreset[] = [
        { id: "reading", name: "Reading", setup: { ...defaultSetup(), contentTypes: ["article"] } },
        { id: "video", name: "Video", setup: { ...defaultSetup(), minutes: 40, contentTypes: ["long", "short"] } },
    ];
    const replaced = new Set(data.presets.filter((preset) => oldStocks.some((old) =>
        preset.id === old.id && preset.name === old.name && setupKey(preset.setup) === setupKey(old.setup),
    )).map((preset) => preset.id));
    const kept = data.presets.filter((preset) => !replaced.has(preset.id));
    const added = starters.filter((starter) => !kept.some((preset) => preset.id === starter.id));
    const presets = [...added, ...kept];
    const defaultId = replaced.has(data.defaultId) ? data.defaultId === "reading" ? "news" : "long-videos" : data.defaultId;
    return { ...data, starterVersion, newsSectionPending: !sectionsLoaded && added.some((preset) => preset.id === "news"), presets, defaultId: defaultId || "news" };
}
export function loadSessionPresets(accountId: number, newsSectionSlug?: string): SessionPresets {
    // Home supplies a second argument after loading sections, including undefined
    // when News is absent. Other surfaces can read before that context exists.
    const sectionsLoaded = arguments.length > 1;
    try {
        const raw = localStorage.getItem(prefix + accountId);
        if (!raw) return rememberMigration(accountId, { ...initialPresets(newsSectionSlug), newsSectionPending: !sectionsLoaded });
        const data = JSON.parse(raw);
        if (!Array.isArray(data?.presets) || !Array.isArray(data?.recent)) return { ...initialPresets(newsSectionSlug), newsSectionPending: !sectionsLoaded };
        const presets: SessionPreset[] = data.presets.flatMap((p: SessionPreset) => {
            const setup = normalizeSetup(p?.setup);
            return p && typeof p.id === "string" && typeof p.name === "string" && setup ? [{ id: p.id, name: p.name, setup }] : [];
        });
        const recent = data.recent.map(normalizeSetup).filter((s: SessionSetup | null): s is SessionSetup => s !== null);
        const normalized: SessionPresets = {
            starterVersion: Number.isInteger(data.starterVersion) ? data.starterVersion : 0,
            newsSectionPending: data.newsSectionPending === true,
            presets, defaultId: presets.some((p: SessionPreset) => p.id === data.defaultId) ? data.defaultId : presets[0]?.id ?? "",
            recent: recent.filter((s: SessionSetup, i: number) => recent.findIndex((other: SessionSetup) => setupKey(s) === setupKey(other)) === i).slice(0, 12),
            lastKey: normalizeKey(data.lastKey),
            consecutive: Number.isInteger(data.consecutive) ? Math.max(0, data.consecutive) : 0,
            dismissed: Array.isArray(data.dismissed) ? data.dismissed.map(normalizeKey).filter(Boolean) : [],
            sessions: Object.fromEntries(Object.entries(data.sessions ?? {}).flatMap(([id, value]) => {
                const setup = normalizeSetup(value);
                return setup ? [[id, setup]] : [];
            }).slice(-30)),
        };
        if (normalized.starterVersion < starterVersion) return rememberMigration(accountId, migrateStarters(normalized, newsSectionSlug, sectionsLoaded));
        if (normalized.newsSectionPending && sectionsLoaded) {
            const unscoped = initialPresets().presets[0];
            const presets = normalized.presets.map((preset) => preset.id === unscoped.id && preset.name === unscoped.name && setupKey(preset.setup) === setupKey(unscoped.setup)
                ? { ...preset, setup: { ...preset.setup, sections: newsSectionSlug ? [newsSectionSlug] : [] } }
                : preset);
            return rememberMigration(accountId, { ...normalized, newsSectionPending: false, presets });
        }
        return normalized;
    } catch { return { ...initialPresets(newsSectionSlug), newsSectionPending: !sectionsLoaded }; }
}
export function storeSessionPresets(accountId: number, data: SessionPresets): boolean {
    try {
        localStorage.setItem(prefix + accountId, JSON.stringify(data));
        window.dispatchEvent(new Event("otium-presets-change"));
        return true;
    } catch { return false; }
}
export function recordSessionSetup(accountId: number, sessionId: string, setup: SessionSetup): boolean {
    const data = loadSessionPresets(accountId);
    const key = setupKey(setup);
    data.consecutive = data.lastKey === key ? data.consecutive + 1 : 1;
    data.lastKey = key;
    data.recent = [setup, ...data.recent.filter((s) => setupKey(s) !== key)].slice(0, 12);
    data.sessions = Object.fromEntries([...Object.entries(data.sessions).filter(([id]) => id !== sessionId), [sessionId, setup]].slice(-30));
    return storeSessionPresets(accountId, data);
}
export function getSessionSetup(accountId: number, sessionId: string): SessionSetup | null {
    return loadSessionPresets(accountId).sessions[sessionId] ?? null;
}
export function isSavedSetup(data: SessionPresets, setup: SessionSetup): boolean {
    return data.presets.some((p) => setupKey(p.setup) === setupKey(setup));
}
export function repeatSuggestion(data: SessionPresets): SessionSetup | null {
    const recent = data.recent[0];
    return recent && data.consecutive >= 2 && !isSavedSetup(data, recent) && !data.dismissed.includes(setupKey(recent)) ? recent : null;
}
export function saveSessionPreset(accountId: number, setup: SessionSetup, name: string, makeDefault = false, editId?: string): boolean {
    if (!normalizeSetup(setup) || !name.trim()) return false;
    const data = loadSessionPresets(accountId);
    const existing = editId ? data.presets.find((p) => p.id === editId) : data.presets.find((p) => setupKey(p.setup) === setupKey(setup));
    const id = existing?.id ?? crypto.randomUUID();
    const preset = { id, name: name.trim().slice(0, 80), setup };
    data.presets = existing ? data.presets.map((p) => p.id === id ? preset : p) : [...data.presets, preset];
    if (makeDefault || !data.defaultId) data.defaultId = id;
    return storeSessionPresets(accountId, data);
}
