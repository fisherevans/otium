import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/sessionPresets.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const storage = new Map();
const writes = [], changes = [];
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { writes.push(key); storage.set(key, value); } };
globalThis.window = { dispatchEvent(event) { changes.push(event.type); } };
const { defaultSetup, initialPresets, starterPresetIds, loadSessionPresets, recordSessionSetup, repeatSuggestion, saveSessionPreset, getSessionSetup, storeSessionPresets, setupKey } = module;
const setup = { ...defaultSetup(), minutes: 25, sections: ['world', 'local'], excluded: ['sport'], contentTypes: ['article'] };
assert.deepEqual(initialPresets('daily-news').presets.map(p => [p.id, p.name, p.setup]), [
    ['news', 'News', { minutes: 10, sections: ['daily-news'], excluded: [], contentTypes: ['article'] }],
    ['shorts', 'Shorts', { minutes: 10, sections: [], excluded: [], contentTypes: ['short'] }],
    ['long-videos', 'Long videos', { minutes: 40, sections: [], excluded: [], contentTypes: ['long'] }],
]);
assert.deepEqual(starterPresetIds, ['news', 'shorts', 'long-videos']);
assert.deepEqual(initialPresets().presets[0].setup.sections, [], 'missing News section falls back to all sources');
assert.equal(loadSessionPresets(1, 'daily-news').presets.length, 3);
assert.deepEqual(changes, [], 'initial load does not dispatch a recursive change event');
const initialWrites = writes.length;
loadSessionPresets(1, 'daily-news');
assert.equal(writes.length, initialWrites, 'already initialized loads do not write');
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
assert.equal(loadSessionPresets(2).defaultId, 'news');
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
assert.equal(loadSessionPresets(3).presets.length, 3);
assert.equal(storage.get('otium.session-presets.v1.3'), '{bad', 'reading malformed storage does not overwrite it');

// A one-time starter migration replaces only the exact old stock presets.
const stock = {
    presets: [
        { id: 'reading', name: 'Reading', setup: { ...defaultSetup(), contentTypes: ['article'] } },
        { id: 'video', name: 'Video', setup: { ...defaultSetup(), minutes: 40, contentTypes: ['long', 'short'] } },
    ],
    defaultId: 'video', recent: [setup], lastKey: setupKey(setup), consecutive: 3,
    dismissed: [setupKey(setup)], sessions: { 'in-progress': setup },
};
storage.set('otium.session-presets.v1.20', JSON.stringify(stock));
const beforeMigrationChanges = changes.length;
const migratedStock = loadSessionPresets(20, 'actual-news-slug');
assert.deepEqual(migratedStock.presets.map(p => p.id), [...starterPresetIds]);
assert.equal(migratedStock.defaultId, 'long-videos', 'old Video default remains a long video session');
assert.deepEqual(migratedStock.presets[0].setup.sections, ['actual-news-slug']);
for (const key of ['recent', 'lastKey', 'consecutive', 'dismissed', 'sessions']) assert.deepEqual(migratedStock[key], stock[key], key);
assert.deepEqual(JSON.parse(storage.get('otium.session-presets.v1.20')), migratedStock, 'migration is durable on the existing account key');
assert.equal(changes.length, beforeMigrationChanges, 'migration does not dispatch the reload event');
assert.deepEqual(loadSessionPresets(20, 'different-news'), migratedStock, 'later library changes do not rewrite an initialized preset');
storage.set('otium.session-presets.v1.21', JSON.stringify({ ...stock, defaultId: 'reading' }));
assert.equal(loadSessionPresets(21).defaultId, 'news');

const editedReading = { ...stock.presets[0], name: 'Morning paper' };
const editedVideo = { ...stock.presets[1], setup: { ...stock.presets[1].setup, minutes: 55 } };
const custom = { id: 'my-preset', name: 'Local lunch', setup };
storage.set('otium.session-presets.v1.22', JSON.stringify({ ...stock, presets: [editedReading, editedVideo, custom], defaultId: 'reading' }));
const migratedEdited = loadSessionPresets(22, 'actual-news-slug');
assert.equal(migratedEdited.defaultId, 'reading', 'edited default retains its own identity');
assert.equal(migratedEdited.presets.length, 6);
assert.deepEqual(migratedEdited.presets.filter(p => !starterPresetIds.includes(p.id)), [editedReading, editedVideo, custom]);
storage.set('otium.session-presets.v1.23', JSON.stringify({ ...stock, presets: [...stock.presets, custom], defaultId: custom.id }));
assert.equal(loadSessionPresets(23).defaultId, custom.id, 'custom default survives stock replacement');

for (const [index, patch] of [{ minutes: 15 }, { sections: ['local'] }, { excluded: ['sport'] }, { contentTypes: ['short'] }].entries()) {
    const edited = { ...stock.presets[0], setup: { ...stock.presets[0].setup, ...patch } };
    storage.set(`otium.session-presets.v1.${30 + index}`, JSON.stringify({ ...stock, presets: [edited], defaultId: edited.id }));
    assert.deepEqual(loadSessionPresets(30 + index).presets.find(p => p.id === edited.id), edited, 'an edited stock setup is preserved');
}

const editedLong = { ...migratedStock.presets[2], name: 'Documentaries', setup: { ...migratedStock.presets[2].setup, minutes: 55 } };
storeSessionPresets(20, { ...migratedStock, presets: [migratedStock.presets[1], editedLong] });
assert.deepEqual(loadSessionPresets(20).presets, [migratedStock.presets[1], editedLong], 'deleted News is not recreated and edited Long videos stays edited');
const allDeleted = { ...loadSessionPresets(20), presets: [], defaultId: '' };
storeSessionPresets(20, allDeleted);
assert.deepEqual(loadSessionPresets(20, 'actual-news-slug').presets, [], 'deleting all presets remains intentional after migration');
const reserved = { id: 'news', name: 'My news', setup };
storage.set('otium.session-presets.v1.24', JSON.stringify({ ...stock, presets: [reserved], defaultId: reserved.id }));
const collision = loadSessionPresets(24);
assert.deepEqual(collision.presets.find(p => p.id === reserved.id), reserved, 'a custom entry owning a starter ID is not overwritten');
assert.equal(new Set(collision.presets.map(p => p.id)).size, collision.presets.length, 'no duplicate IDs');

// Session pages can read presets before Home has loaded the actual sections.
storage.set('otium.session-presets.v1.40', JSON.stringify(stock));
const sessionFirst = loadSessionPresets(40);
assert.equal(sessionFirst.newsSectionPending, true);
assert.deepEqual(sessionFirst.presets.find(p => p.id === 'news').setup.sections, []);
recordSessionSetup(40, 'resume-before-home', setup);
const homeLater = loadSessionPresets(40, 'actual-news-slug');
assert.equal(homeLater.newsSectionPending, false);
assert.deepEqual(homeLater.presets.find(p => p.id === 'news').setup.sections, ['actual-news-slug']);
assert.deepEqual(homeLater.sessions['resume-before-home'], setup);
assert.equal(homeLater.presets.length, 3);
assert.deepEqual(loadSessionPresets(40, 'other-news'), homeLater, 'News scope is finalized only once');
assert.equal(loadSessionPresets(41).newsSectionPending, true, 'fresh account can also enter through a session');
assert.deepEqual(loadSessionPresets(41, 'news-after-session').presets[0].setup.sections, ['news-after-session']);
loadSessionPresets(42);
const absentNews = loadSessionPresets(42, undefined);
assert.equal(absentNews.newsSectionPending, false, 'explicit undefined means section loading found no News');
assert.deepEqual(absentNews.presets[0].setup.sections, []);
assert.deepEqual(loadSessionPresets(42, 'created-later'), absentNews, 'resolved fallback is not silently narrowed later');

for (const [index, edit] of [
    p => ({ ...p, name: 'My news' }),
    p => ({ ...p, setup: { ...p.setup, minutes: 20 } }),
    p => ({ ...p, setup: { ...p.setup, sections: ['local'] } }),
].entries()) {
    const account = 43 + index;
    const pending = loadSessionPresets(account);
    const edited = edit(pending.presets[0]);
    storeSessionPresets(account, { ...pending, presets: [edited, ...pending.presets.slice(1)] });
    const finalized = loadSessionPresets(account, 'actual-news-slug');
    assert.equal(finalized.newsSectionPending, false, 'an edited News starter clears pending resolution');
    assert.deepEqual(finalized.presets[0], edited, 'late section context does not overwrite a News edit');
}
const pendingDeletion = loadSessionPresets(46);
storeSessionPresets(46, { ...pendingDeletion, presets: pendingDeletion.presets.filter(p => p.id !== 'news') });
const deletedPending = loadSessionPresets(46, 'actual-news-slug');
assert.equal(deletedPending.newsSectionPending, false);
assert.equal(deletedPending.presets.some(p => p.id === 'news'), false, 'late context cannot recreate a deleted News starter');
assert.deepEqual(loadSessionPresets(46, 'different-news'), deletedPending);

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
    assert.deepEqual(migrated.presets.find(p => p.id === 'kept-id'), { id: 'kept-id', name: 'My setup', setup: expected });
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
assert.deepEqual(loadSessionPresets(6).presets.find(p => p.id === 'shorts').setup.contentTypes, ['short']);
assert.equal(loadSessionPresets(6).presets.some(p => p.id === 'invalid'), false);
storage.set('otium.session-presets.v1.25', JSON.stringify({ ...stock, presets: [custom], defaultId: custom.id }));
localStorage.setItem = () => { throw new Error('Quota'); };
const unwrittenMigration = loadSessionPresets(25, 'actual-news-slug');
assert.deepEqual(unwrittenMigration.presets.find(p => p.id === custom.id), custom, 'quota failure does not discard custom presets');
assert.equal(unwrittenMigration.defaultId, custom.id);
assert.deepEqual(loadSessionPresets(25, 'actual-news-slug'), unwrittenMigration, 'failed persistence does not accumulate duplicate starters');
assert.equal(saveSessionPreset(1, setup, 'Fail'), false);
localStorage.getItem = () => { throw new Error('Storage disabled'); };
assert.deepEqual(loadSessionPresets(26, 'actual-news-slug'), initialPresets('actual-news-slug'));
console.log('Session presets: News/Shorts/Long starters, one-time stock migration, preserved edits/defaults/history/deletions, legacy content migration, account isolation, repeat suggestions, bounded history, corrupt and unavailable storage PASS');
