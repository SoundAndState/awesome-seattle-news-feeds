import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderStore, selectItems} from '../web/src/reader-store.mjs';
import {readingBackup, restoreReadingBackup} from '../web/src/backup.mjs';
import {makeCatalog, makeSource} from './fixtures/catalog.mjs';
import {makeReaderRuntime} from './fixtures/reader-runtime.mjs';

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

function harness(t, {items = [], statuses, loadFeed = async feed => ({items: [article(feed.id, feed)], transport: 'direct'}), locks, runtime = makeReaderRuntime({now: Date.now(), locks}), loadCatalog = async () => catalog, readLibrary, beforeSave, beforeRemove, configuration = site, initialMode = 'articles'} = {}) {
  const records = {articles: new Map(items.map(item => [item.id, item])), state: new Map(), feeds: new Map((statuses ?? catalog.feeds.map(feed => ({id: feed.id, nextCheck: Date.now() + 1000000}))).map(item => [item.id, item])), settings: new Map()};
  const saves = [], navigations = [];
  let navigationCreated = 0, navigationDestroyed = 0;
  const library = () => Object.fromEntries(Object.entries(records).map(([key, value]) => [key, [...value.values()]]));
  const save = async (name, values) => {if (!values.length) return; saves.push({name, values}); await beforeSave?.(name, values); for (const value of values) records[name].set(value.id, value);};
  const updateStates = async (changes, {articles = [], combine = false} = {}) => {
    const previous = changes.map(item => records.state.get(item.id)).filter(Boolean);
    const states = changes.map(change => {
      const current = records.state.get(change.id), next = {...current, ...change};
      if (combine) for (const key of ['read', 'saved']) next[key] = Boolean(current?.[key] || change[key]);
      return next;
    });
    const candidates = articles.filter(item => states.some(mark => mark.id === item.id && mark.saved));
    const added = candidates.filter(item => !records.articles.has(item.id));
    await save('articles', added);
    await save('state', states.filter(item => {const current = records.state.get(item.id); return item.read !== current?.read || item.saved !== current?.saved;}));
    return {states, articles: states.filter(item => item.saved).map(item => records.articles.get(item.id)).filter(Boolean), previous, added: added.length};
  };
  const store = createReaderStore(configuration, {
    library: {
      openLibrary: readLibrary || (async () => library()),
      save, updateStates,
      importItems: data => updateStates(data.states, {articles: data.articles, combine: true}),
      async removeArticles(ids) {await beforeRemove?.(ids); const removed = ids.filter(id => !records.state.get(id)?.saved); for (const id of removed) records.articles.delete(id); return removed;},
    },
    runtime, loadCatalog, loadFeed, cleanText: value => String(value || ''),
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
  t.after(() => store.getState().destroy());
  return {store, records, saves, navigations, library, runtime, lifecycle: () => ({created: navigationCreated, destroyed: navigationDestroyed})};
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

test('preview, manual, bulk, and external read marks keep Unread rows until an explicit list action', async t => {
  const items = ['preview', 'manual', 'external', 'bulk'].map(id => article(id));
  const {store, records} = harness(t, {items});
  await store.getState().start();
  const original = selectItems(store.getState()).map(item => item.id);
  store.getState().navigate({article: 'preview'});
  await waitUntil(() => store.getState().states.get('preview')?.read);
  store.getState().closeDialog();
  await store.getState().toggleRead('manual');
  await store.getState().toggleSaved('manual');
  records.state.set('external', {id: 'external', read: true});
  await store.getState().syncLibrary();
  assert.deepEqual(selectItems(store.getState()).map(item => item.id), original);
  store.getState().navigate({view: 'unread', filters: true});
  store.getState().closeDialog();
  assert.deepEqual(selectItems(store.getState()).map(item => item.id), original);
  await store.getState().bulkRead();
  assert.deepEqual(selectItems(store.getState()).map(item => item.id), original);
  await store.getState().undo();
  assert.deepEqual(selectItems(store.getState()).map(item => item.id), original);
  store.getState().navigate({view: 'unread'});
  assert.deepEqual(selectItems(store.getState()).map(item => item.id), ['bulk']);
  await store.getState().toggleRead('bulk');
  assert.equal(selectItems(store.getState()).length, 1);
  await store.getState().refresh({resetList: true});
  assert.equal(selectItems(store.getState()).length, 0);
});

test('a read write completing after a list reset does not retain an obsolete row', async t => {
  let release;
  const {store} = harness(t, {items: [article('slow')], beforeSave: async name => {
    if (name === 'state') await new Promise(resolve => {release = resolve;});
  }});
  await store.getState().start();
  const marking = store.getState().toggleRead('slow');
  await waitUntil(() => release);
  store.getState().navigate({view: 'unread'});
  release(); await marking;
  assert.equal(selectItems(store.getState()).length, 0);
});

test('a 200-item feed with five saves does not repeatedly buffer its 45 pruned items', async t => {
  const now = Date.now();
  const items = Array.from({length: 200}, (_, i) => ({...article(`item-${i}`), published: now - i * 1000, firstSeen: now}));
  const {store, records} = harness(t, {items, loadFeed: async () => ({items: [...items].reverse().map(item => ({...item, updated: now + 60000, firstSeen: now + 60000})), transport: 'direct'})});
  for (const item of items.slice(150)) records.state.set(item.id, {id: item.id, read: true, saved: items.indexOf(item) >= 195});
  await store.getState().start();
  assert.equal(store.getState().articles.size, 155);
  for (let attempt = 0; attempt < 2; attempt++) {
    const status = {id: news.id, nextCheck: 0};
    records.feeds.set(news.id, status);
    store.setState(state => ({health: new Map(state.health).set(news.id, status)}));
    await store.getState().refresh();
    assert.equal(store.getState().pending.size, 0);
    assert.equal(store.getState().articles.size, 155);
    assert.equal(records.articles.size, 155);
    assert.equal(store.getState().health.get(news.id).items, 200);
    for (const item of items.slice(195)) assert.equal(store.getState().states.get(item.id).saved, true);
  }
});

test('repeated feed checks never announce entries older than the combined stored window, even during loading', async t => {
  const now = Date.now();
  const items = Array.from({length: 195}, (_, i) => ({...article(`window-${i}`), published: now - i * 1000, firstSeen: now}));
  // The feed omits 45 newer cached stories and still includes 45 older ones.
  // Its own 150-item limit cannot determine what the library will retain.
  let incoming = items.slice(45);
  const {store, records} = harness(t, {items: items.slice(0, 150), loadFeed: async () => ({items: incoming, transport: 'direct'})});
  await store.getState().start();
  const counts = [];
  const unsubscribe = store.subscribe(state => counts.push(state.pending.size));
  t.after(unsubscribe);
  const refresh = async () => {
    const status = {id: news.id, nextCheck: 0};
    records.feeds.set(news.id, status);
    store.setState(state => ({health: new Map(state.health).set(news.id, status)}));
    await store.getState().refresh();
  };
  await refresh();
  await refresh();
  assert.equal(Math.max(...counts), 0, 'discarded articles must never reach the notification');
  assert.equal(records.articles.size, 150);
  const fresh = {...article('genuinely-new'), published: now + 1000};
  incoming = [fresh, ...incoming];
  await refresh();
  assert.deepEqual([...store.getState().pending.keys()], [fresh.id]);
  store.getState().revealPending();
  counts.length = 0;
  await refresh();
  assert.equal(Math.max(...counts), 0);
  assert.equal(selectItems(store.getState()).some(item => item.id === fresh.id), true);
});

test('long undated feeds keep a stable response window instead of cycling their discarded tail', async t => {
  const now = Date.now();
  const items = Array.from({length: 200}, (_, i) => ({...article(`undated-${String(i).padStart(3, '0')}`), published: 0, firstSeen: now}));
  const {store, records} = harness(t, {items: items.slice(0, 150), loadFeed: async () => ({items: items.map(item => ({...item, firstSeen: now + 60000})), transport: 'direct'})});
  await store.getState().start();
  const counts = [];
  t.after(store.subscribe(state => counts.push(state.pending.size)));
  for (let attempt = 0; attempt < 2; attempt++) {
    const status = {id: news.id, nextCheck: 0};
    records.feeds.set(news.id, status);
    store.setState(state => ({health: new Map(state.health).set(news.id, status)}));
    await store.getState().refresh();
  }
  assert.equal(Math.max(...counts), 0);
  assert.deepEqual([...store.getState().articles.keys()], items.slice(0, 150).map(item => item.id));
});

test('returning items with remembered read marks are not announced as new after their bodies expire', async t => {
  const old = {...article('old-read'), firstSeen: Date.now() - 31 * 86400000};
  const fresh = article('new-unread');
  const {store, records} = harness(t, {items: [old, article('current')], loadFeed: async () => ({items: [{...old, firstSeen: Date.now()}, fresh], transport: 'direct'})});
  records.state.set(old.id, {id: old.id, read: true});
  await store.getState().start();
  assert.equal(store.getState().articles.has(old.id), false);
  const status = {id: news.id, nextCheck: 0};
  records.feeds.set(news.id, status);
  store.setState(state => ({health: new Map(state.health).set(news.id, status)}));
  await store.getState().refresh();
  assert.deepEqual([...store.getState().pending.keys()], [fresh.id]);
  assert.equal(store.getState().states.get(old.id).read, true);
  store.getState().revealPending();
  assert.equal(selectItems(store.getState()).some(item => item.id === fresh.id), true);
  assert.equal(selectItems(store.getState()).some(item => item.id === old.id), false);
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
  const {store} = harness(t, {statuses: [], loadFeed: async (feed, {signal}) => {
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
  const backup = {format: 'sound-and-state', version: 1, collection: site.storageNamespace, state: [{id: current.id, saved: true}, {id: current.id, read: true}], savedArticles: [older]};
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

test('field patches and backup imports cannot resurrect another tab’s removed save from stale local marks', async t => {
  const body = article('cross-tab');
  const {store, records} = harness(t, {items: [body]});
  await store.getState().start();
  await store.getState().toggleSaved(body.id);
  records.state.set(body.id, {id: body.id, saved: false, read: false});
  await store.getState().markScrolled([body.id]);
  assert.equal(records.state.get(body.id).saved, false);
  store.setState({states: new Map([[body.id, {id: body.id, saved: true, read: true}]])});
  const backup = {format: 'sound-and-state', version: 1, collection: site.storageNamespace, state: [{id: body.id, read: true}], savedArticles: []};
  await store.getState().importBackup({size: 100, text: async () => JSON.stringify(backup)});
  assert.equal(records.state.get(body.id).saved, false);
  assert.equal(store.getState().states.get(body.id).saved, false);
  records.articles.set(body.id, {...body, title: 'Content from the other tab'});
  store.setState({articles: new Map()});
  await store.getState().importBackup({size: 100, text: async () => JSON.stringify({...backup, state: [{id: body.id, saved: true}]})});
  assert.equal(store.getState().articles.get(body.id).title, 'Content from the other tab');
});

test('Saved reconciles other tabs on visibility and exports current stored marks without waiting for a feed refresh', async t => {
  const body = article('remote-save');
  const {store, records, runtime} = harness(t, {items: [body]});
  await store.getState().start();
  store.getState().navigate({view: 'saved'});
  records.state.set(body.id, {id: body.id, read: true, saved: true});
  runtime.setVisible(false); runtime.setVisible(true);
  await waitUntil(() => store.getState().states.get(body.id)?.saved);
  assert.equal(selectItems(store.getState()).length, 1);
  records.state.set(body.id, {id: body.id, read: false, saved: false});
  const exported = JSON.parse((await store.getState().exportBackup()).content);
  assert.deepEqual(exported.savedArticles, []);
  assert.equal(exported.state[0].saved, false);
  runtime.advance(60000);
  await waitUntil(() => !store.getState().states.get(body.id)?.saved);
  assert.equal(selectItems(store.getState()).length, 0);
});

test('export waits for accepted saves and rejected collections never write imported records', async t => {
  let release;
  const body = article('export-after-save');
  const {store, records, saves} = harness(t, {items: [body], beforeSave: async name => {
    if (name === 'state') await new Promise(resolve => {release = resolve;});
  }});
  await store.getState().start();
  const saving = store.getState().toggleSaved(body.id);
  await waitUntil(() => release);
  let exported = false;
  const exporting = store.getState().exportBackup().then(result => {exported = true; return result;});
  await Promise.resolve();
  assert.equal(exported, false);
  release(); await saving;
  const backup = JSON.parse((await exporting).content);
  assert.equal(backup.savedArticles[0].id, body.id);
  const before = saves.length;
  await store.getState().importBackup({size: 100, text: async () => JSON.stringify({...backup, collection: 'different-reader'})});
  assert.equal(saves.length, before);
  assert.match(store.getState().backupStatus, /another collection/);
  assert.equal(records.state.get(body.id).saved, true);
});

test('a reconciliation snapshot cannot replace fresher feed content or publish after destruction', async t => {
  const body = article('saved-refresh');
  let snapshot, entered, release, blocked = false;
  const {store, records, library} = harness(t, {items: [body], readLibrary: async () => {
    const value = snapshot();
    if (blocked) {entered.resolve(); await release.promise;}
    return value;
  }});
  snapshot = library;
  await store.getState().start();
  records.state.set(body.id, {id: body.id, saved: true});
  blocked = true; entered = Promise.withResolvers(); release = Promise.withResolvers();
  const syncing = store.getState().syncLibrary();
  await entered.promise;
  store.setState({articles: new Map([[body.id, {...body, title: 'Fresh response'}]])});
  release.resolve(); await syncing;
  assert.equal(store.getState().articles.get(body.id).title, 'Fresh response');
  entered = Promise.withResolvers(); release = Promise.withResolvers();
  const late = store.getState().syncLibrary();
  await entered.promise;
  store.getState().destroy();
  const stopped = store.getState();
  release.resolve(); await late;
  assert.equal(store.getState(), stopped);
});

test('two stores use independent clocks, connectivity, subscriptions, and libraries', async t => {
  const online = makeReaderRuntime(), offline = makeReaderRuntime({online: false});
  const first = harness(t, {runtime: online, statuses: []});
  const second = harness(t, {runtime: offline, statuses: [], configuration: {...site, storageNamespace: 'second-reader'}});
  assert.equal(online.subscriptions(), 0);
  await Promise.all([first.store.getState().start(), second.store.getState().start()]);
  await waitUntil(() => first.store.getState().health.has(news.id) && !first.store.getState().session);
  assert.equal(second.store.getState().articles.size, 0);
  assert.equal(first.store.getState().health.get(news.id).lastSuccess, online.now());
  assert.equal(first.store.getState().health.get(news.id).nextCheck, online.now() + 15 * 60000);
  online.advance(60000);
  assert.notEqual(first.store.getState().now, second.store.getState().now);
  offline.setOnline(true);
  await waitUntil(() => second.store.getState().health.has(news.id) && !second.store.getState().session);
  await first.store.getState().toggleSaved(news.id);
  assert.equal(second.store.getState().states.size, 0);
  first.store.getState().destroy();
  assert.equal(online.subscriptions(), 0);
  assert.equal(offline.subscriptions(), 1);
  const destroyed = first.store.getState();
  online.advance(60000);
  await destroyed.refresh();
  assert.equal(first.store.getState(), destroyed);
});

test('visibility cancels refresh and showing the reader resumes it using the injected clock', async t => {
  const runtime = makeReaderRuntime(), requests = [];
  const {store} = harness(t, {runtime, statuses: [], loadFeed: async (feed, {signal}) => {
    const completion = Promise.withResolvers(); requests.push({signal, completion});
    return completion.promise;
  }});
  await store.getState().start();
  await waitUntil(() => requests.length === 1);
  runtime.setVisible(false);
  assert.equal(requests[0].signal.aborted, true);
  runtime.advance(60000);
  assert.equal(requests.length, 1);
  const pausedTime = store.getState().now;
  runtime.setVisible(true);
  requests[0].completion.resolve({items: [article('canceled')], transport: 'direct'});
  await waitUntil(() => requests.length === 2);
  requests[1].completion.resolve({items: [article('resumed')], transport: 'direct'});
  await waitUntil(() => !store.getState().session);
  assert.equal(store.getState().articles.has('canceled'), false);
  assert.equal(store.getState().articles.has('resumed'), true);
  assert.equal(store.getState().health.get(news.id).lastSuccess, pausedTime + 60000);
});

test('destroy aborts catalog loading and its late completion cannot replace a restarted reader', async t => {
  const requests = [];
  const {store, runtime} = harness(t, {loadCatalog: ({signal}) => {
    const completion = Promise.withResolvers(); requests.push({signal, completion}); return completion.promise;
  }});
  const first = store.getState().start();
  await waitUntil(() => requests.length === 1);
  store.getState().destroy();
  assert.equal(requests[0].signal.aborted, true);
  const second = store.getState().start();
  await waitUntil(() => requests.length === 2);
  requests[1].completion.resolve(catalog);
  await second;
  const current = store.getState().catalog;
  requests[0].completion.resolve(makeCatalog({feeds: [makeSource({id: 'obsolete'})]}));
  await first;
  assert.equal(store.getState().catalog, current);
  assert.equal(runtime.subscriptions(), 1);
});

test('cancellation while content is saving cannot mark the feed fresh or change a restarted session', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const {store, records, saves} = harness(t, {statuses: [], beforeSave: async name => {
    if (name === 'articles') {entered.resolve(); await release.promise;}
  }});
  await store.getState().start();
  await entered.promise;
  store.getState().destroy();
  for (const feed of catalog.feeds) records.feeds.set(feed.id, {id: feed.id, nextCheck: Date.now() + 1000000});
  await store.getState().start();
  const restarted = store.getState();
  release.resolve();
  await waitUntil(() => records.articles.has(news.id));
  // Drain the promise continuations of the canceled refresh.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.getState().health.get(news.id).lastSuccess, undefined);
  assert.equal(saves.some(write => write.name === 'feeds'), false);
  assert.equal(store.getState().session, null);
  assert.equal(store.getState(), restarted);
});

test('restart waits for accepted save intents before restoring the library', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const item = article('save-before-restart');
  const {store, records, runtime} = harness(t, {items: [item], beforeSave: async name => {
    if (name === 'state') {entered.resolve(); await release.promise;}
  }});
  await store.getState().start();
  const saving = store.getState().toggleSaved(item.id);
  await entered.promise;
  store.getState().destroy();
  const restarting = store.getState().start();
  assert.equal(store.getState().ready, false);
  release.resolve();
  await Promise.all([saving, restarting]);
  assert.equal(store.getState().states.get(item.id).saved, true);
  assert.equal(records.state.get(item.id).saved, true);
  assert.equal(runtime.subscriptions(), 1);
});
