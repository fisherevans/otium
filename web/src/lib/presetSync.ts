import { api } from "@/api/client";
import { loadSessionPresets, normalizePresetSetup, onSessionPresetsStored, storeSessionPresets, type SessionPreset, type SessionPresets } from "@/lib/sessionPresets";

// Server sync for saved presets and mixes (#203). They live on the server so they
// follow the account and agents can manage them; localStorage is a cache for
// instant loads. Recent setups, repeat-suggestion state and per-session crumbs stay
// local: they are this device's history, not configuration.
//
// syncSessionPresets pulls the server list into the cache, or the first time an
// account syncs, uploads the browser's presets so nothing is lost. After a sync,
// every store that changes the list or default pushes it. Before a sync has
// succeeded nothing is pushed, so a stale cache never overwrites what an agent saved.
const synced = new Set<number>();
const pushed = new Map<number, string>();
const presetsKey = (data: SessionPresets) => JSON.stringify([data.presets, data.defaultId]);

onSessionPresetsStored((accountId, data) => {
    if (!synced.has(accountId)) return;
    const key = presetsKey(data);
    if (pushed.get(accountId) === key) return;
    pushed.set(accountId, key);
    api.putPresets(data.presets, data.defaultId).catch(() => {
        pushed.delete(accountId); // the next change retries the whole list
        window.dispatchEvent(new Event("otium-presets-sync-error"));
    });
});

export async function syncSessionPresets(accountId: number): Promise<void> {
    const server = await api.presets();
    const local = loadSessionPresets(accountId);
    const fromServer: SessionPreset[] = server.presets.flatMap((p) => {
        const setup = normalizePresetSetup(p.setup);
        return setup ? [{ id: p.id, name: p.name, setup }] : [];
    });
    if (!server.initialized) {
        // First sync for this account: upload this browser's presets, keeping any an
        // agent already added on the server.
        const merged = { ...local, presets: [...local.presets, ...fromServer.filter((p) => !local.presets.some((l) => l.id === p.id))] };
        await api.putPresets(merged.presets, merged.defaultId);
        settle(accountId, merged);
        return;
    }
    const presets = fromServer;
    const next: SessionPresets = { ...local, presets, defaultId: presets.some((p) => p.id === server.default_id) ? server.default_id : presets[0]?.id ?? "" };
    settle(accountId, next);
}

// settle writes the synced list to the cache and records it as pushed in the
// normalized form later loads produce, so an unrelated store (a session record)
// doesn't see a different key and push the same list again.
function settle(accountId: number, data: SessionPresets) {
    pushed.set(accountId, presetsKey(data));
    storeSessionPresets(accountId, data);
    pushed.set(accountId, presetsKey(loadSessionPresets(accountId)));
    synced.add(accountId);
}
