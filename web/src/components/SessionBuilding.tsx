import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./session-building.css";

// #186: shown the moment a session is requested, until its first card is ready.
// A small sliding-block puzzle packs the feed: eight tiles in a 3x3 tray, one gap,
// a tile slides into the gap every beat and never straight back. It reads as
// "putting it together", not "waiting". Shared by Home (while the server builds
// the session) and the session page (while it loads), so the hand-off is one
// continuous screen. Under reduced motion the tiles hold still.
const SIZE = 3;
const START = [0, 1, 2, 3, 4, 5, 6, 7, -1]; // tile ids by cell; -1 is the gap
const TONES = ["a", "b", "c", "a", "c", "b", "c", "a"];

function neighbours(cell: number) {
    const r = Math.floor(cell / SIZE), c = cell % SIZE, out: number[] = [];
    if (r > 0) out.push(cell - SIZE);
    if (r < SIZE - 1) out.push(cell + SIZE);
    if (c > 0) out.push(cell - 1);
    if (c < SIZE - 1) out.push(cell + 1);
    return out;
}

export function SessionBuilding({ label = "Building your session", detail, continued = false }: { label?: string; detail?: string; continued?: boolean }) {
    const [cells, setCells] = useState(START);
    useEffect(() => {
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        let last = -1;
        const timer = window.setInterval(() => {
            setCells((prev) => {
                const gap = prev.indexOf(-1);
                const options = neighbours(gap).filter((cell) => prev[cell] !== last);
                const from = options[Math.floor(Math.random() * options.length)];
                last = prev[from];
                const next = prev.slice();
                next[gap] = prev[from];
                next[from] = -1;
                return next;
            });
        }, 520);
        return () => window.clearInterval(timer);
    }, []);
    const position = new Map<number, number>();
    cells.forEach((tile, cell) => { if (tile >= 0) position.set(tile, cell); });
    return createPortal(
        <div className={`session-building ${continued ? "continued" : ""}`} role="status" aria-live="polite">
            <div className="building-tray" aria-hidden>
                {START.filter((tile) => tile >= 0).map((tile) => {
                    const cell = position.get(tile) ?? 0;
                    return <span key={tile} className={`building-tile ${TONES[tile]}`}
                        style={{ transform: `translate(${(cell % SIZE) * 100}%, ${Math.floor(cell / SIZE) * 100}%)` }} />;
                })}
            </div>
            <p className="building-label">{label}</p>
            {detail && <p className="building-detail">{detail}</p>}
        </div>,
        document.body,
    );
}
