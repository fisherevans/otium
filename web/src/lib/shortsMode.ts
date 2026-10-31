import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

const changed = "otium-shorts-mode-change";

// A viewing choice belongs to this browser and account, independent of feed presets.
export function useShortsMode() {
    const { user } = useAuth();
    const key = `otium:shorts-mode:${user?.id ?? "unknown"}`;
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
