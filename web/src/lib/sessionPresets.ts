export type SessionMedia = "all" | "read" | "video" | "audio";
export interface SessionSetup {
    minutes: number;
    sections: string[];
    excluded: string[];
    media: SessionMedia;
    includeShorts: boolean;
}
export interface SessionPreset { id: string; name: string; setup: SessionSetup }
export interface SessionPresets {
    presets: SessionPreset[];
    defaultId: string;
    recent: SessionSetup[];
    lastKey: string;
    consecutive: number;
    dismissed: string[];
    sessions: Record<string, SessionSetup>;
}
const prefix = "otium.session-presets.v1.";
export const defaultSetup = (): SessionSetup => ({ minutes: 10, sections: [], excluded: [], media: "all", includeShorts: true });
export const mediaLabel: Record<SessionMedia, string> = { all: "All media", read: "Reading", video: "Video", audio: "Audio" };
export function setupKey(setup: SessionSetup): string {
    return JSON.stringify([setup.minutes, [...setup.sections].sort(), [...setup.excluded].sort(), setup.media, setup.includeShorts]);
}
function validSetup(value: unknown): value is SessionSetup {
    if (!value || typeof value !== "object") return false;
    const s = value as SessionSetup;
    return Number.isInteger(s.minutes) && s.minutes >= 5 && s.minutes <= 120 &&
        Array.isArray(s.sections) && s.sections.every((v) => typeof v === "string") &&
        Array.isArray(s.excluded) && s.excluded.every((v) => typeof v === "string") &&
        ["all", "read", "video", "audio"].includes(s.media) && typeof s.includeShorts === "boolean";
}
export function initialPresets(): SessionPresets {
    return {
        presets: [
            { id: "reading", name: "Reading", setup: { ...defaultSetup(), media: "read" } },
            { id: "video", name: "Video", setup: { ...defaultSetup(), minutes: 40, media: "video" } },
        ],
        defaultId: "reading", recent: [], lastKey: "", consecutive: 0, dismissed: [], sessions: {},
    };
}
export function loadSessionPresets(accountId: number): SessionPresets {
    try {
        const raw = localStorage.getItem(prefix + accountId);
        if (!raw) return initialPresets();
        const data = JSON.parse(raw);
        if (!Array.isArray(data.presets) || !Array.isArray(data.recent)) return initialPresets();
        const presets = data.presets.filter((p: SessionPreset) => p && typeof p.id === "string" && typeof p.name === "string" && validSetup(p.setup));
        return {
            presets, defaultId: presets.some((p: SessionPreset) => p.id === data.defaultId) ? data.defaultId : presets[0]?.id ?? "",
            recent: data.recent.filter(validSetup).slice(0, 12),
            lastKey: typeof data.lastKey === "string" ? data.lastKey : "",
            consecutive: Number.isInteger(data.consecutive) ? Math.max(0, data.consecutive) : 0,
            dismissed: Array.isArray(data.dismissed) ? data.dismissed.filter((v: unknown) => typeof v === "string") : [],
            sessions: Object.fromEntries(Object.entries(data.sessions ?? {}).filter((entry): entry is [string, SessionSetup] => validSetup(entry[1])).slice(-30)),
        };
    } catch { return initialPresets(); }
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
    if (!validSetup(setup) || !name.trim()) return false;
    const data = loadSessionPresets(accountId);
    const existing = editId ? data.presets.find((p) => p.id === editId) : data.presets.find((p) => setupKey(p.setup) === setupKey(setup));
    const id = existing?.id ?? crypto.randomUUID();
    const preset = { id, name: name.trim().slice(0, 80), setup };
    data.presets = existing ? data.presets.map((p) => p.id === id ? preset : p) : [...data.presets, preset];
    if (makeDefault || !data.defaultId) data.defaultId = id;
    return storeSessionPresets(accountId, data);
}
