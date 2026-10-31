import { useEffect, useState } from "react";

type Playback = { sessionId: string; muted: boolean; captions: boolean };

// Keep only this tab's active session choice. A new session always starts quiet.
export function useSessionPlayback(accountId: number | undefined, sessionId: string) {
    const key = `otium:playback:${accountId ?? "unknown"}`;
    function read(): Playback {
        try {
            const saved = JSON.parse(sessionStorage.getItem(key) || "null");
            if (saved?.sessionId === sessionId) return { sessionId, muted: saved.muted !== false, captions: saved.captions !== false };
        } catch { /* Storage is optional. */ }
        return { sessionId, muted: true, captions: true };
    }
    const [state, setState] = useState(() => ({ key, value: read() }));
    const value = state.key === key && state.value.sessionId === sessionId ? state.value : read();
    useEffect(() => { setState({ key, value: read() }); }, [key, sessionId]);
    function update(change: Partial<Pick<Playback, "muted" | "captions">>) {
        const next = { ...value, ...change };
        setState({ key, value: next });
        try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* The live choice still applies. */ }
    }
    return { ...value, setMuted: (muted: boolean) => update({ muted }), setCaptions: (captions: boolean) => update({ captions }) };
}
