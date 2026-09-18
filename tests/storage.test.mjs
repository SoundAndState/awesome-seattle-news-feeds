import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserLibrary} from '../web/src/storage.mjs';
import {articleItem} from './fixtures/feeds.mjs';

const storedItem = (id, overrides) => ({...articleItem(id, overrides), id});

function database({before = async () => {}} = {}) {
  const records = Object.fromEntries(['articles', 'state', 'feeds', 'settings'].map(name => [name, new Map()]));
  const db = {version: () => ({stores() {}})};
  for (const [name, recordsById] of Object.entries(records)) db[name] = {
    async toArray() {const snapshot = [...recordsById.values()]; await before(name, 'read'); return snapshot;},
    async bulkPut(items) {await before(name, 'write'); for (const item of items) {assert.equal(typeof item.id, 'string'); recordsById.set(item.id, item);}},
    async bulkDelete(ids) {await before(name, 'delete'); for (const id of ids) recordsById.delete(id);},
  };
  return {db, records};
}

test('library instances isolate namespaces, fallback items, and warning recipients', async () => {
  const names = [], warnings = [[], []];
  const createDatabase = name => {
    names.push(name);
    return database({before: async () => {throw new Error('Storage unavailable');}}).db;
  };
  const first = createBrowserLibrary({storageNamespace: 'first-collection', capabilities: {backups: true}}, {createDatabase});
  const second = createBrowserLibrary({storageNamespace: 'second-collection', capabilities: {backups: false}}, {createDatabase});
  await Promise.all([first.openLibrary(message => warnings[0].push(message)), second.openLibrary(message => warnings[1].push(message))]);
  const item = storedItem('shared-id');
  await Promise.all([first.save('articles', [{...item, title: 'First collection'}]), second.save('articles', [{...item, title: 'Second collection'}])]);
  await first.save('state', [{id: item.id, saved: true}]);
  assert.deepEqual(names, ['first-collection', 'second-collection']);
  assert.equal((await first.openLibrary()).articles[0].title, 'First collection');
  assert.equal((await second.openLibrary()).articles[0].title, 'Second collection');
  assert.deepEqual((await second.openLibrary()).state, []);
  assert.deepEqual(warnings.map(messages => messages.length), [1, 1]);
  assert.match(warnings[0][0], /Export reading backup/);
  assert.doesNotMatch(warnings[1][0], /Export reading backup/);
  await first.removeArticles([item.id]);
  assert.deepEqual((await first.openLibrary()).articles, []);
  assert.equal((await second.openLibrary()).articles.length, 1);
});

test('a slow library read cannot overwrite a newer accepted save in the fallback', async () => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let fail = false;
  const {db, records} = database({before: async (name, action) => {
    if (fail) throw new Error('Storage unavailable');
    if (name === 'articles' && action === 'read') {entered.resolve(); await release.promise;}
  }});
  const old = storedItem('same', {title: 'Earlier content'}), current = {...old, title: 'Current content'};
  records.articles.set(old.id, old);
  const library = createBrowserLibrary({storageNamespace: 'fixture'}, {createDatabase: () => db});
  const opening = library.openLibrary();
  await entered.promise;
  const saving = library.save('articles', [current]);
  fail = true;
  release.resolve();
  await Promise.all([opening, saving]);
  assert.equal((await library.openLibrary()).articles[0].title, 'Current content');
});

test('fallback keeps accepted saves and deletions when a persistent write fails', async () => {
  let fail = false;
  const {db} = database({before: async () => {if (fail) throw new Error('Write failed');}});
  const library = createBrowserLibrary({storageNamespace: 'fixture'}, {createDatabase: () => db});
  const item = storedItem('saved');
  await library.openLibrary();
  await library.save('articles', [item]);
  fail = true;
  await Promise.all([library.save('state', [{id: item.id, saved: true}]), library.save('state', [{id: item.id, saved: true, read: true}])]);
  const restored = await library.openLibrary();
  assert.deepEqual(restored.articles, [item]);
  assert.deepEqual(restored.state, [{id: item.id, saved: true, read: true}]);
  await library.removeArticles([item.id]);
  assert.deepEqual((await library.openLibrary()).articles, []);
});

test('a fresh persistent snapshot removes items deleted by another tab from the fallback', async () => {
  let fail = false;
  const {db, records} = database({before: async () => {if (fail) throw new Error('Storage unavailable');}});
  const library = createBrowserLibrary({storageNamespace: 'fixture'}, {createDatabase: () => db});
  const item = storedItem('removed');
  await library.save('articles', [item]);
  await library.openLibrary();
  records.articles.delete(item.id);
  await library.openLibrary();
  fail = true;
  assert.deepEqual((await library.openLibrary()).articles, []);
});
