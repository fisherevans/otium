import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/sessionPresets.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const storage = new Map();
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
globalThis.window = { dispatchEvent() {} };
const { defaultSetup, loadSessionPresets, recordSessionSetup, repeatSuggestion, saveSessionPreset, getSessionSetup, storeSessionPresets, setupKey } = module;
const setup = { ...defaultSetup(), minutes: 25, sections: ['world', 'local'], excluded: ['sport'], contentTypes: ['article'] };
assert.equal(loadSessionPresets(1).presets.length, 2);
recordSessionSetup(1, 'first', setup);
assert.equal(repeatSuggestion(loadSessionPresets(1)), null);
recordSessionSetup(1, 'second', { ...setup, sections: ['local', 'world'] });
assert.deepEqual(repeatSuggestion(loadSessionPresets(1)), { ...setup, sections: ['local', 'world'] });
assert.equal(loadSessionPresets(1).recent.length, 1);
assert.deepEqual(getSessionSetup(1, 'first'), setup);
assert.equal(getSessionSetup(2, 'first'), null);
assert.equal(saveSessionPreset(1, setup, 'Weekday', true), true);
assert.equal(repeatSuggestion(loadSessionPresets(1)), null);
const data = loadSessionPresets(1);
assert.equal(data.presets.find((p) => p.id === data.defaultId).name, 'Weekday');
assert.equal(loadSessionPresets(2).defaultId, 'reading');
recordSessionSetup(1, 'third', { ...setup, minutes: 30 });
assert.equal(repeatSuggestion(loadSessionPresets(1)), null);
recordSessionSetup(1, 'fourth', { ...setup, minutes: 30 });
const repeated = loadSessionPresets(1);
storeSessionPresets(1, { ...repeated, dismissed: [setupKey(repeated.recent[0])] });
assert.equal(repeatSuggestion(loadSessionPresets(1)), null);
for (let i = 0; i < 40; i++) recordSessionSetup(1, `bounded-${i}`, { ...setup, minutes: 5 + i });
assert.equal(loadSessionPresets(1).recent.length, 12);
assert.equal(Object.keys(loadSessionPresets(1).sessions).length, 30);
storage.set('otium.session-presets.v1.3', '{bad');
assert.equal(loadSessionPresets(3).presets.length, 2);
// Loading older browser storage must preserve defaults and repeat/dismissal state.
const legacy = (media, includeShorts) => ({ minutes: 25, sections: ['news'], excluded: [], media, includeShorts });
const mappings = [
    ['all', true, ['article', 'long', 'short']],
    ['all', false, ['article', 'long']],
    ['read', true, ['article']],
    ['audio', false, ['article']],
    ['video', true, ['long', 'short']],
    ['video', false, ['long']],
];
for (const [media, includeShorts, selected] of mappings) {
    const old = legacy(media, includeShorts);
    const oldKey = JSON.stringify([25, ['news'], [], media, includeShorts]);
    storage.set('otium.session-presets.v1.4', JSON.stringify({
        presets: [{ id: 'kept-id', name: 'My setup', setup: old }], defaultId: 'kept-id', recent: [old],
        lastKey: oldKey, consecutive: 2, dismissed: [oldKey], sessions: { resume: old },
    }));
    const migrated = loadSessionPresets(4);
    const expected = { minutes: 25, sections: ['news'], excluded: [], contentTypes: selected };
    assert.deepEqual(migrated.presets, [{ id: 'kept-id', name: 'My setup', setup: expected }]);
    assert.equal(migrated.defaultId, 'kept-id');
    assert.deepEqual(migrated.recent, [expected]);
    assert.equal(migrated.lastKey, setupKey(expected));
    assert.deepEqual(migrated.dismissed, [setupKey(expected)]);
    assert.equal(migrated.consecutive, 2);
    assert.deepEqual(getSessionSetup(4, 'resume'), expected);
    // A migrated dismissal still suppresses a suggestion after its saved preset is removed.
    storeSessionPresets(4, { ...migrated, presets: [] });
    assert.equal(repeatSuggestion(loadSessionPresets(4)), null);
}
const shortsOnly = { ...defaultSetup(), contentTypes: ['short'] };
assert.equal(saveSessionPreset(5, shortsOnly, 'Short break', true), true);
assert.deepEqual(loadSessionPresets(5).presets.find(p => p.name === 'Short break').setup, shortsOnly);
assert.equal(saveSessionPreset(5, { ...shortsOnly, contentTypes: [] }, 'Empty'), false);
assert.equal(saveSessionPreset(5, { ...shortsOnly, contentTypes: ['unknown'] }, 'Unknown'), false);
assert.equal(setupKey({ ...shortsOnly, contentTypes: ['short', 'article'] }), setupKey({ ...shortsOnly, contentTypes: ['article', 'short'] }));
// Explicit content selection wins over legacy properties, including invalid empty selections.
storage.set('otium.session-presets.v1.6', JSON.stringify({
    presets: [{ id: 'shorts', name: 'Shorts', setup: { ...legacy('read', false), contentTypes: ['short'] } },
        { id: 'invalid', name: 'Invalid', setup: { ...legacy('all', true), contentTypes: [] } }],
    defaultId: 'shorts', recent: [],
}));
assert.deepEqual(loadSessionPresets(6).presets.map(p => [p.id, p.setup.contentTypes]), [['shorts', ['short']]]);
localStorage.setItem = () => { throw new Error('Quota'); };
assert.equal(saveSessionPreset(1, setup, 'Fail'), false);
console.log('Session presets: legacy migration, content combinations, account isolation, canonical deduplication, repeat suggestion, dismissal, defaults, session association, bounded history, corrupt and unavailable storage PASS');
