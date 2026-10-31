import "./shorts-mode.css";

export function ShortsModeToggle({ enabled, onChange }: { enabled: boolean; onChange: (value: boolean) => void }) {
    return <button type="button" className="shorts-mode-toggle" role="switch" aria-checked={enabled}
        aria-label="Shorts viewing mode" onClick={() => onChange(!enabled)}>
        <span><strong>Shorts mode</strong><small>Large video · Autoplay</small></span>
        <span className="shorts-mode-state" aria-hidden>{enabled ? "On" : "Off"}</span>
    </button>;
}
