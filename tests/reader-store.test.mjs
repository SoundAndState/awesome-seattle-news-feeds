import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderStore, selectItems} from '../web/src/reader-store.mjs';
import {readingBackup, restoreReadingBackup} from '../web/src/backup.mjs';
import {makeCatalog, makeSource} from './fixtures/catalog.mjs';

const news = makeSource();
const posts = makeSource({id: 'bluesky-reporter', category: 'bluesky'});
const catalog = makeCatalog({feeds: [news, posts]});
const site = {storageNamespace: 'fixture-reader', proxy: '', base: '/', opmlUrl: null};
const article = (id, feed = news) => ({id, title: `Item ${id}`, html: `<p>Item ${id}</p>`, excerpt: `Item ${id}`, url: `https://publisher.example/${id}`, sourceName: feed.name, feedIds: [feed.id], published: Date.now(), firstSeen: Date.now(), kind: feed.category === 'bluesky' ? 'posts' : 'articles'});
const waitUntil = async predicate => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('The expected asynchronous state did not arrive.');
};

function harness(t, {items = [], statuses, loadFeed = async feed => ({items: [article(feed.id, feed)], transport: 'direct'}), locks, readLibrary, beforeSave, beforeRemove, configuration = site, initialMode = 'articles'} = {}) {
  const originals = new Map(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', {configurable: true, value: new EventTarget()});
  Object.defineProperty(globalThis, 'document', {configurable: true, value: Object.assign(new EventTarget(), {hidden: false})});
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {onLine: true, locks}});
  const records = {articles: new Map(items.map(item => [item.id, item])), state: new Map(), feeds: new Map((statuses ?? catalog.feeds.map(feed => ({id: feed.id, nextCheck: Date.now() + 1000000}))).map(item => [item.id, item])), settings: new Map()};
  const saves = [], navigations = [];
  let navigationCreated = 0, navigationDestroyed = 0;
  const library = () => Object.fromEntries(Object.entries(records).map(([key, value]) => [key, [...value.values()]]));
  const store = createReaderStore(configuration, {
    openLibrary: readLibrary || (async () => library()),
    async save(name, values) {saves.push({name, values}); await beforeSave?.(name, values); for (const value of values) records[name].set(value.id, value);},
    async removeArticles(ids) {await beforeRemove?.(ids); for (const id of ids) records.articles.delete(id);},
    loadCatalog: async () => catalog, loadFeed, cleanText: value => String(value || ''),
    createNavigation({normalize, apply}) {
      navigationCreated++;
      let current = normalize({view: 'unread', mode: initialMode});
      return {
        start() {apply(current, 0);},
        go(changes) {current = normalize({...current, article: '', ...changes}); navigations.push(current); apply(current, 0);},
        switchMode(mode) {this.go({mode, source: '', category: '', view: 'unread'});},
        close() {this.go({article: '', about: false, filters: false, feedList: false});},
        endSearch() {}, destroy() {navigationDestroyed++;},
      };
    },
  });
  t.after(() => {
    store.getState().destroy();
    for (const [key, descriptor] of originals) {if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];}
  });
  return {store, records, saves, navigations, library, lifecycle: () => ({created: navigationCreated, destroyed: navigationDestroyed})};
}

test('scroll marking replaces immutable snapshots and retains rows until the selection changes', async t => {
  const first = article('one'), second = article('two');
  const {store} = harness(t, {items: [first, second]});
  await store.getState().start();
  const before = store.getState();
  await before.markScrolled([first.id]);
  const after = store.getState();
  assert.notEqual(after.states, before.states);
  assert.notEqual(after.retainedRead, before.retainedRead);
  assert.equal(before.states.has(first.id), false);
  assert.equal(before.retainedRead.has(first.id), false);
  assert.equal(after.states.get(first.id).read, true);
  assert.equal(selectItems(after).length, 2);
  assert.equal(selectItems(after, {retainRead: false}).length, 1);
  after.navigate({query: 'Item'});
  assert.equal(store.getState().retainedRead.size, 0);
  assert.equal(selectItems(store.getState()).length, 1);
  const savedBefore = store.getState();
  await savedBefore.toggleSaved(second.id);
  assert.equal(savedBefore.states.has(second.id), false);
  assert.equal(store.getState().states.get(second.id).saved, true);
});

test('saved confirmation waits for storage and concurrent save, read, and scroll intents preserve every flag', async t => {
  let releaseSave, blocked = false;
  const item = article('durable');
  const {store, records, saves} = harness(t, {items: [item], beforeSave: async name => {
    if (name === 'state' && !blocked) {blocked = true; await new Promise(resolve => {releaseSave = resolve;});}
  }});
  await store.getState().start();
  const saving = store.getState().toggleSaved(item.id);
  const reading = store.getState().toggleRead(item.id);
  const scrolling = store.getState().markScrolled([item.id]);
  await waitUntil(() => releaseSave);
  assert.equal(store.getState().states.has(item.id), false);
  assert.equal(records.state.has(item.id), false);
  assert.equal(saves.filter(write => write.name === 'state').length, 1);
  releaseSave();
  await Promise.all([saving, reading, scrolling]);
  assert.deepEqual(store.getState().states.get(item.id), {id: item.id, saved: true, read: true});
  assert.deepEqual(records.state.get(item.id), {id: item.id, saved: true, read: true});
  assert.equal(store.getState().retainedRead.has(item.id), true);
});

test('bulk read and undo join pending saves without discarding saved marks', async t => {
  let releaseSave, blocked = false;
  const item = article('bulk');
  const {store, records} = harness(t, {items: [item], beforeSave: async name => {
    if (name === 'state' && !blocked) {blocked = true; await new Promise(resolve => {releaseSave = resolve;});}
  }});
  await store.getState().start();
  const saving = store.getState().toggleSaved(item.id);
  const marking = store.getState().bulkRead();
  await waitUntil(() => releaseSave);
  assert.equal(store.getState().undoRead.length, 0);
  releaseSave(); await Promise.all([saving, marking]);
  assert.deepEqual(records.state.get(item.id), {id: item.id, saved: true, read: true});
  await store.getState().undo();
  assert.deepEqual(records.state.get(item.id), {id: item.id, saved: true, read: false});
  assert.deepEqual(store.getState().states.get(item.id), records.state.get(item.id));
});

test('saving a newly displayed item waits for its content as well as its saved mark', async t => {
  let releaseContent;
  const item = article('new-content');
  const {store, records, saves} = harness(t, {items: [item], beforeSave: async name => {
    if (name === 'articles') await new Promise(resolve => {releaseContent = resolve;});
  }});
  await store.getState().start();
  records.articles.delete(item.id);
  const saving = store.getState().toggleSaved(item.id);
  await waitUntil(() => releaseContent);
  assert.equal(store.getState().states.has(item.id), false);
  assert.equal(saves.filter(write => write.name === 'state').length, 0);
  releaseContent(); await saving;
  assert.equal(records.articles.get(item.id).id, item.id);
  assert.equal(records.state.get(item.id).saved, true);
  assert.equal(store.getState().states.get(item.id).saved, true);
});

function expireItemAndFeed(store, records, item) {
  const old = {...item, firstSeen: Date.now() - 31 * 86400000};
  const status = {id: news.id, nextCheck: 0};
  records.articles.set(item.id, old); records.feeds.set(news.id, status);
  store.setState(state => ({articles: new Map(state.articles).set(item.id, old), health: new Map(state.health).set(news.id, status)}));
}

test('refresh pruning waits for a pending save before discarding expired items', async t => {
  let releaseSave;
  const item = article('old-save');
  const {store, records} = harness(t, {items: [item], loadFeed: async () => ({items: [], transport: 'direct'}), beforeSave: async name => {
    if (name === 'state') await new Promise(resolve => {releaseSave = resolve;});
  }});
  await store.getState().start();
  expireItemAndFeed(store, records, item);
  const saving = store.getState().toggleSaved(item.id);
  await waitUntil(() => releaseSave);
  const refresh = store.getState().refresh();
  await waitUntil(() => store.getState().health.get(news.id)?.lastSuccess);
  assert.equal(store.getState().articles.has(item.id), true);
  assert.equal(records.articles.has(item.id), true);
  releaseSave(); await Promise.all([saving, refresh]);
  assert.equal(store.getState().articles.has(item.id), true);
  assert.equal(records.articles.has(item.id), true);
  assert.equal(records.state.get(item.id).saved, true);
});

test('saving a visible item while pruning writes its removal restores its content and saved mark', async t => {
  let releaseRemoval;
  const item = article('save-during-prune');
  const {store, records} = harness(t, {items: [item], loadFeed: async () => ({items: [], transport: 'direct'}), beforeRemove: async () => {
    await new Promise(resolve => {releaseRemoval = resolve;});
  }});
  await store.getState().start();
  expireItemAndFeed(store, records, item);
  const refresh = store.getState().refresh();
  await waitUntil(() => releaseRemoval);
  const saving = store.getState().toggleSaved(item.id);
  releaseRemoval(); await Promise.all([refresh, saving]);
  assert.equal(store.getState().articles.has(item.id), true);
  assert.equal(records.articles.has(item.id), true);
  assert.equal(records.state.get(item.id).saved, true);
});

test('a late response from a canceled mode cannot add items or record a feed failure', async t => {
  const requests = [];
  let releaseArticles;
  const {store} = harness(t, {statuses: [], loadFeed: async (feed, proxy, {signal}) => {
    requests.push({id: feed.id, signal});
    if (feed.id === news.id) await new Promise(resolve => {releaseArticles = resolve;});
    return {items: [article(feed.id, feed)], transport: 'direct'};
  }});
  await store.getState().start();
  await waitUntil(() => releaseArticles);
  store.getState().switchMode('posts');
  assert.equal(requests[0].signal.aborted, true);
  releaseArticles();
  await waitUntil(() => store.getState().health.has(posts.id) && !store.getState().session);
  assert.deepEqual(requests.map(request => request.id), [news.id, posts.id]);
  assert.equal(store.getState().articles.has(news.id), false);
  assert.equal(store.getState().health.has(news.id), false);
  assert.equal(store.getState().articles.has(posts.id), true);
});

for (const initialMode of ['articles', 'posts']) {
  test(`canonical duplicates retain the article and its publisher when ${initialMode} arrive first`, async t => {
    const id = 'https://publisher.example/shared-report';
    const {store, records} = harness(t, {initialMode, statuses: [], loadFeed: async feed => ({
      items: [{...article(id, feed), url: id,
        title: feed.id === news.id ? 'The complete report' : 'A short linked post',
        html: feed.id === news.id ? '<p>The article content.</p>' : '<p>My response to the report.</p>',
        author: feed.id === news.id ? 'Article reporter' : 'Post author'}], transport: 'direct',
    })});
    await store.getState().start();
    const first = initialMode === 'articles' ? news : posts;
    const second = initialMode === 'articles' ? posts : news;
    await waitUntil(() => store.getState().health.has(first.id) && !store.getState().session);
    await store.getState().setItemState(id, {saved: true, read: true});
    store.getState().switchMode(initialMode === 'articles' ? 'posts' : 'articles');
    await waitUntil(() => store.getState().health.has(second.id) && !store.getState().session);
    const merged = store.getState().articles.get(id);
    assert.equal(store.getState().articles.size, 1);
    assert.equal(merged.id, id);
    assert.equal(merged.kind, 'articles');
    assert.equal(merged.title, 'The complete report');
    assert.equal(merged.html, '<p>The article content.</p>');
    assert.equal(merged.author, 'Article reporter');
    assert.equal(merged.sourceName, news.name);
    assert.deepEqual(merged.feedIds, [news.id, posts.id]);
    assert.deepEqual(records.articles.get(id), merged);
    assert.deepEqual(store.getState().states.get(id), {id, saved: true, read: true});
    assert.deepEqual(records.state.get(id), {id, saved: true, read: true});
  });
}

test('overlapping preview read intents write an unchanged mark only once', async t => {
  const item = article('read-once');
  const {store, saves} = harness(t, {items: [item]});
  await store.getState().start();
  await Promise.all([store.getState().setItemState(item.id, {read: true}), store.getState().setItemState(item.id, {read: true})]);
  assert.equal(saves.filter(write => write.name === 'state').length, 1);
  assert.equal(store.getState().states.get(item.id).read, true);
});

test('a queued refresh rechecks persisted freshness before announcing or fetching', async t => {
  let unlock, fetches = 0, lockName;
  const {store, records} = harness(t, {statuses: [], locks: {async request(name, options, work) {lockName = name; await new Promise(resolve => {unlock = resolve;}); return work();}}, loadFeed: async () => {fetches++; return {items: []};}});
  await store.getState().start();
  await waitUntil(() => unlock);
  assert.equal(store.getState().loadingRun, null);
  records.feeds.set(news.id, {id: news.id, nextCheck: Date.now() + 1000000});
  records.articles.set('shared', article('shared'));
  unlock();
  await waitUntil(() => !store.getState().session);
  assert.equal(lockName, 'fixture-reader-refresh');
  assert.equal(fetches, 0);
  assert.equal(store.getState().loadingRun, null);
  assert.equal(store.getState().articles.has('shared'), true);
});

test('destroy during initialization discards its completion and a later mount initializes once', async t => {
  let releaseFirst, reads = 0;
  const library = {articles: [], state: [], settings: [], feeds: catalog.feeds.map(feed => ({id: feed.id, nextCheck: Date.now() + 1000000}))};
  const {store, lifecycle} = harness(t, {readLibrary: async () => {if (!reads++) await new Promise(resolve => {releaseFirst = resolve;}); return library;}});
  const first = store.getState().start();
  await waitUntil(() => releaseFirst);
  store.getState().destroy();
  await store.getState().start();
  releaseFirst(); await first;
  assert.deepEqual(lifecycle(), {created: 1, destroyed: 0});
  assert.equal(store.getState().ready, true);
  await store.getState().start();
  assert.deepEqual(lifecycle(), {created: 1, destroyed: 0});
  store.getState().destroy();
  assert.deepEqual(lifecycle(), {created: 1, destroyed: 1});
});

test('a dialog opened while the library loads remains open when navigation becomes ready', async t => {
  let release;
  const {store} = harness(t, {readLibrary: async () => {await new Promise(resolve => {release = resolve;}); return {articles: [], state: [], settings: [], feeds: catalog.feeds.map(feed => ({id: feed.id, nextCheck: Date.now() + 1000000}))};}});
  const starting = store.getState().start();
  await waitUntil(() => release);
  store.getState().navigate({feedList: true});
  assert.equal(store.getState().route.feedList, true);
  release(); await starting;
  assert.equal(store.getState().ready, true);
  assert.equal(store.getState().route.feedList, true);
  store.getState().closeDialog();
  assert.equal(store.getState().route.feedList, false);
});

test('a posts-only collection opens its enabled mode and uses its configured category labels', async t => {
  const {store} = harness(t, {configuration: {...site, capabilities: {articles: false, posts: true}, categoryLabels: {bluesky: 'Neighborhood voices'}}});
  await store.getState().start();
  assert.equal(store.getState().route.mode, 'posts');
  assert.equal(store.getState().categoryMap.get('bluesky').shortTitle, 'Neighborhood voices');
  store.getState().switchMode('articles');
  assert.equal(store.getState().route.mode, 'posts');
});

test('backup restoration never overwrites current content on disk or in the active library', async t => {
  const current = {...article('same'), title: 'Current story'};
  const {store, records} = harness(t, {items: [current]});
  await store.getState().start();
  const older = {...current, title: 'Outdated story'};
  const backup = {format: 'sound-and-state', version: 1, state: [{id: current.id, saved: true}, {id: current.id, read: true}], savedArticles: [older]};
  await store.getState().importBackup({size: 500, text: async () => JSON.stringify(backup)});
  assert.equal(store.getState().articles.get(current.id).title, 'Current story');
  assert.equal(records.articles.get(current.id).title, 'Current story');
  assert.deepEqual(store.getState().states.get(current.id), {id: current.id, saved: true, read: true});
  assert.equal(readingBackup(store.getState(), site).savedArticles[0].title, 'Current story');
});

test('backup validation is atomic and preserved post kind survives a removed source', () => {
  const item = article('orphan', posts);
  const current = {states: new Map(), articles: new Map()};
  const backup = {format: 'sound-and-state', version: 1, state: [{id: item.id, saved: true}], savedArticles: [item]};
  const restored = restoreReadingBackup(backup, current, value => String(value));
  assert.equal(restored.articles[0].kind, 'posts');
  assert.equal(current.states.size, 0);
  assert.equal(current.articles.size, 0);
  assert.throws(() => restoreReadingBackup({...backup, savedArticles: [item, {id: 'invalid'}]}, current, String));
  assert.equal(current.states.size, 0);
  assert.equal(current.articles.size, 0);
});
