import { useState } from "react";
import { Bookmark } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Dialog } from "@/components/Dialog";
import { contentLabel, getSessionSetup, isSavedSetup, loadSessionPresets, saveSessionPreset, type SessionSetup } from "@/lib/sessionPresets";
import "@/styles/launcher.css";

export function SavePresetDialog({ setup, onClose, name = "", editId }: { setup: SessionSetup; onClose: () => void; name?: string; editId?: string }) {
    const { user } = useAuth();
    const [title, setTitle] = useState(name || `${setup.minutes} min ${contentLabel(setup).toLowerCase()}`);
    const [makeDefault, setMakeDefault] = useState(false);
    const [error, setError] = useState("");
    return <Dialog open kicker={editId ? "Edit preset" : "Save preset"} onClose={onClose}>
        <form className="launcher-sheet-body" onSubmit={(event) => {
            event.preventDefault();
            if (user && saveSessionPreset(user.id, setup, title, makeDefault, editId)) onClose();
            else setError("Couldn't save this preset. Check that browser storage is available and retry.");
        }}>
            <label className="launcher-field">Name<input autoFocus maxLength={80} className="field" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="launcher-check"><input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)}/>Use as default</label>
            <p className="launcher-meta">Saved on this device for your account.</p>
            {error && <p role="alert">{error}</p>}
            <button className="btn" type="submit" disabled={!title.trim()}>Save preset</button>
        </form>
    </Dialog>;
}
export function SessionPresetPrompt({ sessionId }: { sessionId: string }) {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [, refresh] = useState(0);
    const setup = user ? getSessionSetup(user.id, sessionId) : null;
    if (!user || !setup || isSavedSetup(loadSessionPresets(user.id), setup)) return null;
    return <>
        <button className="launcher-save-link" onClick={() => setOpen(true)}><Bookmark size={17}/>Save session as preset</button>
        {open && <SavePresetDialog setup={setup} onClose={() => { setOpen(false); refresh((n) => n + 1); }}/>}
    </>;
}
