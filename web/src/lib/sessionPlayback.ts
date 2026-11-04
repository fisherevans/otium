import { useEffect, useRef, useState } from "react";

type Playback = { sessionId: string; muted: boolean; captions: boolean; asked: boolean };

// Keep only this tab's active session choice. A new session starts quiet until
// the sound card (#213) asks; `asked` records that it has, so it asks once.
export function useSessionPlayback(accountId: number | undefined, sessionId: string) {
    const key = `otium:playback:${accountId ?? "unknown"}`;
    function read(): Playback {
        try {
            const saved = JSON.parse(sessionStorage.getItem(key) || "null");
            if (saved?.sessionId === sessionId) return { sessionId, muted: saved.muted !== false, captions: saved.captions !== false, asked: saved.asked === true };
        } catch { /* Storage is optional. */ }
        return { sessionId, muted: true, captions: true, asked: false };
    }
    const [state, setState] = useState(() => ({ key, value: read() }));
    const value = state.key === key && state.value.sessionId === sessionId ? state.value : read();
    useEffect(() => { setState({ key, value: read() }); }, [key, sessionId]);
    // Several updates can land in one tap (the sound card answers, then the
    // player reports its sound); each merges into the latest, not this render's.
    const latest = useRef(value);
    latest.current = value;
    function update(change: Partial<Pick<Playback, "muted" | "captions" | "asked">>) {
        const next = { ...latest.current, ...change };
        latest.current = next;
        setState({ key, value: next });
        try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* The live choice still applies. */ }
    }
    return { ...value, setMuted: (muted: boolean) => update({ muted }), setCaptions: (captions: boolean) => update({ captions }),
        answer: (muted: boolean) => update({ muted, asked: true }) };
}

// The sound card's highlighted choice: the last one made on this device (#213).
// Highlighted, never auto-picked; a device without one highlights audio off.
const SOUND_DEFAULT = "otium:sound-default";
export function soundDefaultMuted(): boolean {
    try { return localStorage.getItem(SOUND_DEFAULT) !== "on"; } catch { return true; }
}
export function rememberSoundDefault(muted: boolean) {
    try { localStorage.setItem(SOUND_DEFAULT, muted ? "off" : "on"); } catch { /* Next time highlights audio off. */ }
}
