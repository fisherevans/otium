// Which inline players have YouTube's own controls on, and a way for the item's
// ··· sheet to flip that for the card on screen. Shorts go through shortsBus;
// this covers every other inline YouTube player, which has no bus.

const native = new Map<number, () => void>();
const on = new Set<number>();

export function registerPlayer(itemId: number, toggle: () => void): () => void {
    native.set(itemId, toggle);
    return () => { if (native.get(itemId) === toggle) native.delete(itemId); };
}

export function setNativeOn(itemId: number, value: boolean) {
    if (value) on.add(itemId); else on.delete(itemId);
}

export function hasPlayer(itemId: number): boolean { return native.has(itemId); }
export function nativeOn(itemId: number): boolean { return on.has(itemId); }
export function toggleNative(itemId: number) { native.get(itemId)?.(); }
