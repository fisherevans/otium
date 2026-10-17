import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Brand } from "./Brand";

export interface InstrumentConfig {
    mode?: "session" | "reader" | "app";
    eyebrow: string;
    label: string;
    onMenu?: () => void;
    menuLabel?: string;
    onLabel?: () => void;
    leadingIcon?: ReactNode;
    action?: { label: string; onClick: () => void; icon?: ReactNode; disabled?: boolean };
}

const InstrumentContext = createContext<{
    config: InstrumentConfig | null;
    set: (config: InstrumentConfig | null) => void;
}>({ config: null, set: () => {} });

export function InstrumentProvider({ children }: { children: ReactNode }) {
    const [config, set] = useState<InstrumentConfig | null>(null);
    return <InstrumentContext.Provider value={{ config, set }}>{children}</InstrumentContext.Provider>;
}

// Callbacks read the latest page state without making every page render update the shell.
export function useInstrument(config: InstrumentConfig | null) {
    const { set } = useContext(InstrumentContext);
    const latest = useRef(config);
    latest.current = config;
    const signature = JSON.stringify(config && [config.mode, config.eyebrow, config.label, config.menuLabel,
        Boolean(config.onMenu), Boolean(config.onLabel), config.action?.label, config.action?.disabled]);
    useLayoutEffect(() => {
        const current = latest.current;
        set(current && { ...current,
            onMenu: current.onMenu ? () => latest.current?.onMenu?.() : undefined,
            onLabel: current.onLabel ? () => latest.current?.onLabel?.() : undefined,
            action: current.action ? { ...current.action, onClick: () => latest.current?.action?.onClick() } : undefined,
        });
        return () => set(null);
    }, [signature, set]);
}

export function useInstrumentConfig() { return useContext(InstrumentContext).config; }

export function ContextInstrument({ mode = "app", eyebrow, label, onMenu, menuLabel = "More options", onLabel, leadingIcon, action }: InstrumentConfig) {
    const meaning = <><small className="instrument-eyebrow"><Brand compact /><span>{eyebrow}</span></small><span className="instrument-label">{label}</span></>;
    return <div className="context-instrument-wrap" data-mode={mode}>
        <div className="context-instrument" key={`${mode}:${eyebrow}`}>
            {onMenu && <button className="instrument-menu" onClick={onMenu} aria-label={menuLabel}>{leadingIcon || <MoreHorizontal size={22} />}</button>}
            {onLabel ? <button className="instrument-meaning" onClick={onLabel}>{meaning}</button> : <div className="instrument-meaning">{meaning}</div>}
            {action && <button className="instrument-action" disabled={action.disabled} onClick={action.onClick}>{action.label}{action.icon}</button>}
        </div>
    </div>;
}
