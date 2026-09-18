import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserLibrary} from '../web/src/storage.mjs';
import {restoreReadingBackup, readingBackup} from '../web/src/backup.mjs';
import {configureLibrarySchema, LIBRARY_VERSION} from '../web/src/library-schema.mjs';
import {normalizeFeed} from '../web/src/feeds.mjs';
import {prepareItem} from '../web/src/item-model.mjs';
import {makeSource} from './fixtures/catalog.mjs';
import {contractFeed, contractNow} from './fixtures/source-contracts.mjs';
import {libraryDatabase} from './fixtures/browser-library.mjs';

const site = {storageNamespace: 'fixture-reader', capabilities: {backups: true}};
const item = (id = 'story') => prepareItem({...normalizeFeed(contractFeed('rss', {url: `https://publisher.example/${id}`}), makeSource(), contractNow)[0], sourceName: 'Fixture publisher'}, String);

test('concurrent connections patch independent flags, and explicit same-field changes commit in order', async t => {
  const createDatabase = libraryDatabase(t);
  const a = createBrowserLibrary(site, {createDatabase}), b = createBrowserLibrary(site, {createDatabase});
  const body = item();
  await Promise.all([a.openLibrary(), b.openLibrary()]);
  await Promise.all([a.updateStates([{id: body.id, saved: true}], {articles: [body]}), b.updateStates([{id: body.id, read: true}])]);
  assert.deepEqual((await b.openLibrary()).state, [{id: body.id, saved: true, read: true}]);
  await a.updateStates([{id: body.id, saved: false}]);
  await b.updateStates([{id: body.id, read: false}]);
  assert.deepEqual((await a.openLibrary()).state, [{id: body.id, saved: false, read: false}]);
});

test('aborted multi-table import rolls back disk and retains the entire intent in fallback', async t => {
  const createDatabase = libraryDatabase(t), warnings = [];
  let connection;
  const library = createBrowserLibrary(site, {createDatabase: name => (connection = createDatabase(name))});
  const old = item('existing'), imported = item('imported');
  await library.openLibrary(message => warnings.push(message));
  await library.updateStates([{id: old.id, saved: true}], {articles: [old]});
  connection.state.hook('creating', () => {throw new Error('Interrupted after content was written');});
  const result = await library.importItems({states: [{id: imported.id, saved: true, read: true}], articles: [imported]});
  assert.equal(result.added, 1);
  const fallback = await library.openLibrary();
  assert.equal(fallback.articles.length, 2);
  assert.equal(fallback.state.find(row => row.id === imported.id).saved, true);
  assert.equal(warnings.length, 1);
  const reopened = createBrowserLibrary(site, {createDatabase});
  const disk = await reopened.openLibrary();
  assert.deepEqual(disk.articles, [old]);
  assert.deepEqual(disk.state, [{id: old.id, saved: true}]);
  await reopened.importItems({states: result.states, articles: result.articles});
  assert.equal((await reopened.openLibrary()).articles.length, 2);
});

test('a failed save preserves flags committed by another connection before the failed transaction', async t => {
  const createDatabase = libraryDatabase(t), body = item();
  let connection;
  const a = createBrowserLibrary(site, {createDatabase: name => (connection = createDatabase(name))});
  const b = createBrowserLibrary(site, {createDatabase});
  await a.openLibrary();
  await b.updateStates([{id: body.id, read: true}]);
  connection.state.hook('updating', () => {throw new Error('Quota exceeded');});
  await a.updateStates([{id: body.id, saved: true}], {articles: [body]});
  assert.deepEqual((await a.openLibrary()).state, [{id: body.id, saved: true, read: true}]);
  assert.deepEqual((await b.openLibrary()).state, [{id: body.id, read: true}]);
  assert.deepEqual((await b.openLibrary()).articles, []);
});

test('imports preserve newer disk content and marks; cleanup never removes a concurrently saved body', async t => {
  const createDatabase = libraryDatabase(t), body = item();
  const a = createBrowserLibrary(site, {createDatabase}), b = createBrowserLibrary(site, {createDatabase});
  await a.openLibrary();
  await b.updateStates([{id: body.id, saved: true, read: true}], {articles: [{...body, title: 'Newer reporting'}]});
  const result = await a.importItems({states: [{id: body.id, saved: true, read: false}], articles: [body]});
  assert.equal(result.articles[0].title, 'Newer reporting');
  assert.equal(result.states[0].read, true);
  assert.equal(result.added, 0);
  const marksOnly = await a.importItems({states: [{id: body.id, saved: true}], articles: []});
  assert.equal(marksOnly.articles[0].title, 'Newer reporting');
  assert.deepEqual(await a.removeArticles([body.id]), []);
  await b.updateStates([{id: body.id, saved: false}]);
  assert.deepEqual(await a.removeArticles([body.id]), [body.id]);
  // Saving a still-visible item after cleanup restores the body atomically.
  await b.updateStates([{id: body.id, saved: true}], {articles: [body]});
  assert.equal((await a.openLibrary()).articles.length, 1);
});

test('version-one libraries upgrade without rewriting identities or marks, and reopen idempotently', async t => {
  const createDatabase = libraryDatabase(t), body = item();
  const old = createDatabase(site.storageNamespace);
  old.version(1).stores({articles: '&id, published, firstSeen, *feedIds', state: '&id', feeds: '&id'});
  await old.articles.put(body);
  await old.state.put({id: body.id, read: true, saved: true});
  old.close();
  const library = createBrowserLibrary(site, {createDatabase});
  const upgraded = await library.openLibrary();
  assert.deepEqual(upgraded.articles, [body]);
  assert.deepEqual(upgraded.state, [{id: body.id, read: true, saved: true}]);
  assert.deepEqual(upgraded.settings, []);
  await library.save('settings', [{id: 'theme', value: 'dark'}]);
  const probe = createDatabase(site.storageNamespace);
  configureLibrarySchema(probe);
  await probe.open();
  assert.equal(probe.verno, LIBRARY_VERSION);
  assert.equal((await createBrowserLibrary(site, {createDatabase}).openLibrary()).settings[0].value, 'dark');
});

test('unknown future backup versions and foreign collections cannot alter the library; legacy ownership is explicit', () => {
  const body = item(), current = {states: new Map(), articles: new Map()};
  const data = readingBackup({states: new Map([[body.id, {id: body.id, saved: true}]]), articles: new Map([[body.id, body]])}, site);
  assert.equal(restoreReadingBackup(data, current, String, site).articles.length, 1);
  for (const invalid of [{...data, version: 2}, {...data, collection: 'another-reader'}, {...data, collection: null}, {...data, collection: ''}]) {
    assert.throws(() => restoreReadingBackup(invalid, current, String, site));
  }
  const {collection, ...legacy} = data;
  assert.throws(() => restoreReadingBackup(legacy, current, String, site), /another collection/);
  assert.equal(restoreReadingBackup(legacy, current, String, {storageNamespace: 'sound-and-state'}).articles.length, 1);
  assert.equal(current.states.size + current.articles.size, 0);
});

test('a future database is not downgraded or cleared by an older reader', async t => {
  const createDatabase = libraryDatabase(t), body = item(), warnings = [];
  const future = createDatabase(site.storageNamespace);
  configureLibrarySchema(future);
  future.version(LIBRARY_VERSION + 1).stores({future: '&id'});
  await future.articles.put(body);
  await future.future.put({id: 'future-data', value: 'Preserve this'});
  future.close();
  const older = createBrowserLibrary(site, {createDatabase});
  await older.openLibrary(message => warnings.push(message));
  await older.updateStates([{id: body.id, saved: true}], {articles: [body]});
  const probe = createDatabase(site.storageNamespace);
  await probe.open();
  assert.equal(probe.verno, LIBRARY_VERSION + 1);
  assert.equal((await probe.table('future').get('future-data')).value, 'Preserve this');
  assert.equal((await probe.table('articles').get(body.id)).title, body.title);
  assert.equal(warnings.length, 1);
  assert.deepEqual(await probe.table('state').toArray(), []);
});
