import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

const changed = "otium-shorts-mode-change";

// A viewing choice belongs to this browser and account, independent of feed presets.
export function useShortsMode() {
    return useViewingChoice("shorts-mode");
}

// #206: the full-screen session view is no longer a choice, so the old
// "shorts-immersive" preference (#184) is dropped from storage once.
try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith("otium:shorts-immersive:")) localStorage.removeItem(key);
    }
} catch { /* Storage may be unavailable; nothing reads the key any more. */ }

function useViewingChoice(name: string) {
    const { user } = useAuth();
    const key = `otium:${name}:${user?.id ?? "unknown"}`;
    const read = () => {
        try { return localStorage.getItem(key) !== "off"; }
        catch { return true; }
    };
    const [enabled, setEnabled] = useState(read);
    useEffect(() => {
        const refresh = () => setEnabled(read());
        refresh();
        window.addEventListener(changed, refresh);
        window.addEventListener("storage", refresh);
        return () => {
            window.removeEventListener(changed, refresh);
            window.removeEventListener("storage", refresh);
        };
    }, [key]);
    function update(value: boolean) {
        setEnabled(value);
        try {
            localStorage.setItem(key, value ? "on" : "off");
            window.dispatchEvent(new Event(changed));
        } catch { /* The current page still honors the choice without storage. */ }
    }
    return [enabled, update] as const;
}
