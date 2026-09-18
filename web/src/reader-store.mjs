import {createStore} from 'zustand/vanilla';
import {normalizeCatalog} from './catalog.mjs';
import {inBatches, nextRefresh} from './refresh-policy.mjs';
import {mergeSourceItem} from './item-model.mjs';
import {feedMode, itemMode, normalizeRoute, matchesItem} from './reader-state.mjs';
import {articlesCsv} from './export.mjs';
import {readingBackup, restoreReadingBackup} from './backup.mjs';

const emptyRoute = {mode: 'articles', view: 'unread', category: '', source: '', query: '', savedKind: 'all', unavailableOnly: false, limit: 60, article: '', about: false, feedList: false, filters: false};
const sortItems = (a, b) => (b.published || b.updated || 0) - (a.published || a.updated || 0) || b.firstSeen - a.firstSeen || a.id.localeCompare(b.id);

export function sourceName(item, state) {
  return state.feedMap.get(item.feedIds[0])?.name || item.sourceName || 'Previously saved source';
}

export function selectSources(state, all = false) {
  const {mode, category, source} = state.route;
  return (state.catalog?.feeds || []).filter(feed => feedMode(feed) === mode && (all || ((!category || feed.category === category) && (!source || feed.id === source))));
}

export function selectItems(state, {retainRead = true} = {}) {
  const {route, states, articles, feedMap, excluded, retainedRead} = state;
  const query = route.query.toLocaleLowerCase().trim();
  return [...articles.values()].filter(item => matchesItem(item, route, feedMap, excluded)
    && (route.view !== 'unread' || !states.get(item.id)?.read || (retainRead && retainedRead.has(item.id)))
    && (route.view !== 'saved' || states.get(item.id)?.saved)
    && (!query || `${item.title} ${item.author || ''} ${item.excerpt || ''} ${sourceName(item, state)}`.toLocaleLowerCase().includes(query))).sort(sortItems);
}

/**
 * Coordinate reader state using explicit services. See reader-services.mjs for
 * browser composition and docs/reader-architecture.md for the service contract.
 * No browser connection, listener, or timer is created by constructing a store.
 */
export function createReaderStore(site, {library, loadFeed, cleanText, loadCatalog, createNavigation, runtime}) {
  const {openLibrary, save, updateStates, importItems, removeArticles} = library;
  let navigation, queuedNavigation, activeRun, loadingRun, retryAgain, startupController, started = false, epoch = 0;
  let stateWrites = Promise.resolve();
  const stateVersions = new Map();
  let onNavigate = () => {}, removeListeners = () => {};
  const readingStarted = new Set();
  const store = createStore((set, get) => {
    const notice = message => set({notice: message});
    const announce = message => set({announcement: message});
    const navigate = (changes, options) => {
      if (navigation) navigation.go(changes, options);
      else {
        queuedNavigation = {changes: {...queuedNavigation?.changes, ...changes}, options};
        set(state => ({route: {...state.route, ...changes}}));
      }
    };
    const publishRun = () => set({session: activeRun ? {...activeRun} : null, loadingRun: loadingRun ? {...loadingRun} : null});
    const setPreference = async (name, value, record) => {
      set({[name]: value});
      await save('settings', [record]);
    };
    // A visible saved/read mark confirms that storage has settled (including
    // its in-memory fallback). Serialize intents so overlapping actions merge
    // with the latest completed mark instead of overwriting another flag.
    const queueStateWrite = operation => {
      const result = stateWrites.then(operation);
      stateWrites = result.catch(() => {});
      return result;
    };
    const commitStates = (updates, patch = {}) => {
      const states = new Map(get().states);
      for (const item of updates) {
        states.set(item.id, item);
        stateVersions.set(item.id, (stateVersions.get(item.id) || 0) + 1);
      }
      set({states, ...patch});
    };
    const setItemState = (id, changes, {retain = false} = {}) => {
      // Capture a displayed item before queuing: pruning may already be writing
      // its removal when the reader chooses Save on the still-visible card.
      const displayedItem = get().articles.get(id) || get().pending.get(id);
      return queueStateWrite(async () => {
        const current = get().states.get(id);
        const change = typeof changes === 'function' ? changes(current) : changes;
        const article = get().articles.get(id) || get().pending.get(id) || displayedItem;
        const result = await updateStates([{id, ...change}], {articles: article ? [article] : []});
        const item = result.states[0];
        const storedArticle = result.articles[0] || article;
        const retainedRead = new Set(get().retainedRead);
        if (!retain) retainedRead.delete(id);
        const restored = item.saved && storedArticle && !get().articles.has(id) && !get().pending.has(id) ? {articles: new Map(get().articles).set(id, storedArticle)} : {};
        commitStates([item], {retainedRead, ...restored});
      });
    };
    async function prune(isCurrent = () => true) {
      return queueStateWrite(async () => {
        if (!isCurrent()) return;
        const state = get();
        if (state.catalogFallback) return;
        const kept = new Map(), remove = [], cutoff = runtime.now() - 30 * 86400000;
        for (const item of [...state.articles.values(), ...state.pending.values()].sort((a, b) => b.firstSeen - a.firstSeen)) {
          if (state.states.get(item.id)?.saved) continue;
          const ids = item.feedIds.filter(id => state.feedMap.has(id));
          if (item.firstSeen < cutoff || !ids.length || ids.every(id => (kept.get(id) || 0) >= 150)) remove.push(item.id);
          else for (const id of ids) kept.set(id, (kept.get(id) || 0) + 1);
        }
        if (!remove.length) return;
        const removed = await removeArticles(remove);
        if (!isCurrent()) return;
        const articles = new Map(get().articles), pending = new Map(get().pending);
        for (const id of removed) {articles.delete(id); pending.delete(id);}
        set({articles, pending});
      });
    }
    // Reconcile local marks even in Saved, offline, or when no feed is due.
    // Queue behind accepted intents; a destroyed/restarted reader ignores this
    // completion. Keep new unsaved content buffered while someone is reading.
    function syncLibrary() {
      const generation = epoch;
      return queueStateWrite(async () => {
        if (!started || !get().ready || generation !== epoch) return;
        const before = get();
        const stored = await openLibrary(notice);
        if (!started || generation !== epoch) return;
        const articles = new Map(get().articles), pending = new Map(get().pending);
        const states = new Map(stored.state.map(item => [item.id, item]));
        for (const item of stored.articles) {
          if (states.get(item.id)?.saved) {
            const local = articles.get(item.id) || pending.get(item.id);
            const previous = before.articles.get(item.id) || before.pending.get(item.id);
            articles.set(item.id, local && local !== previous ? local : item);
            pending.delete(item.id);
          }
          else if (!articles.has(item.id) && !pending.has(item.id)) pending.set(item.id, item);
        }
        for (const id of new Set([...get().states.keys(), ...states.keys()])) stateVersions.set(id, (stateVersions.get(id) || 0) + 1);
        set({states, articles, pending});
      });
    }
    const exportSnapshot = () => queueStateWrite(async () => {
      const stored = await openLibrary(notice);
      return {...get(), articles: new Map(stored.articles.map(item => [item.id, item])), states: new Map(stored.state.map(item => [item.id, item]))};
    });
    async function fetchSource(feed, run) {
      const previous = get().health.get(feed.id) || {id: feed.id};
      try {
        const {items, transport, fetchedAt, stale} = await loadFeed(feed, {signal: run.controller.signal});
        if (run.controller.signal.aborted) return;
        const state = get(), articles = new Map(state.articles), pending = new Map(state.pending);
        const merged = items.map(item => {
          const existing = articles.get(item.id) || pending.get(item.id);
          const article = mergeSourceItem(existing, item, feed, state.feedMap, cleanText);
          if (!articles.has(item.id) && item.id !== get().route.article && (run.buffer || readingStarted.has(run.mode))) pending.set(item.id, article);
          else articles.set(item.id, article);
          return article;
        });
        set({articles, pending});
        await save('articles', merged);
        if (run.controller.signal.aborted) return;
        const now = runtime.now();
        const status = {id: feed.id, lastAttempt: now, lastSuccess: now, nextCheck: nextRefresh(0, now), failures: 0, items: items.length, transport, fetchedAt, stale};
        set(state => ({health: new Map(state.health).set(feed.id, status)}));
        await save('feeds', [status]);
      } catch (error) {
        if (run.controller.signal.aborted) return;
        const failures = (previous.failures || 0) + 1;
        const now = runtime.now();
        const status = {...previous, id: feed.id, lastAttempt: now, failures, nextCheck: nextRefresh(failures, now), error: error.message.slice(0, 420)};
        set(state => ({health: new Map(state.health).set(feed.id, status)}));
        await save('feeds', [status]);
      } finally {
        if (!run.controller.signal.aborted) run.done++;
        if (activeRun === run) publishRun();
      }
    }
    async function refresh({retryFailed = false, only = ''} = {}) {
      const state = get();
      if (!started || !state.catalog || ['saved', 'excluded'].includes(state.route.view) || !runtime.isVisible()) return;
      if (activeRun) {retryAgain = {retryFailed, only}; return;}
      if (!runtime.isOnline()) {notice('You’re offline. You can still read any items this reader already has in your library. Reconnect to load new items.'); return;}
      const due = feed => (retryFailed && get().health.get(feed.id)?.error) || !get().health.get(feed.id)?.nextCheck || get().health.get(feed.id).nextCheck <= runtime.now();
      const queue = selectSources(state).filter(feed => (!state.excluded.has(feed.id) || state.route.source === feed.id || only === feed.id || state.route.view === 'sources') && (!only || feed.id === only) && due(feed));
      if (!queue.length) return;
      const run = {mode: state.route.mode, controller: new AbortController(), done: 0, total: queue.length, buffer: [...state.articles.values()].some(item => itemMode(item, state.feedMap) === state.route.mode)};
      activeRun = run; publishRun();
      const work = async () => {
        const beforeVersions = new Map(stateVersions);
        const stored = await openLibrary(notice);
        if (run.controller.signal.aborted) return;
        const current = get(), states = new Map(current.states), articles = new Map(current.articles), pending = new Map(current.pending), health = new Map(current.health);
        for (const item of stored.state) if (stateVersions.get(item.id) === beforeVersions.get(item.id)) states.set(item.id, item);
        for (const item of stored.articles) if (!articles.has(item.id) && !pending.has(item.id)) (run.buffer ? pending : articles).set(item.id, item);
        for (const item of stored.feeds) if ((item.nextCheck || 0) > (health.get(item.id)?.nextCheck || 0)) health.set(item.id, item);
        set({states, articles, pending, health});
        const remaining = queue.filter(due);
        if (!remaining.length) return;
        run.total = remaining.length; loadingRun = run; publishRun();
        announce(`${get().route.view === 'sources' ? 'Checking sources. Checking availability.' : `Loading ${run.mode}. Wait to start reading.`}`);
        await inBatches(remaining, async feed => {if (!run.controller.signal.aborted) await fetchSource(feed, run);});
      };
      try {
        await runtime.withLock(`${site.storageNamespace}-refresh`, run.controller.signal, work);
        if (!run.controller.signal.aborted) await prune(() => !run.controller.signal.aborted);
      } catch (error) {
        if (!run.controller.signal.aborted) notice('The reader could not finish checking for new items. You can still read your library. Choose Refresh to try again.');
      } finally {
        run.finished = true; run.completed = !run.controller.signal.aborted && run.done === run.total;
        if (activeRun === run) {
          activeRun = null;
          publishRun();
          if (!run.controller.signal.aborted && run.mode === get().route.mode && get().route.view !== 'saved') announce(run.completed ? 'Feed check complete.' : 'Feed check paused.');
          if (retryAgain && started) {const next = retryAgain; retryAgain = null; refresh(next);}
        }
      }
    }
    async function start(callbacks = {}) {
      if (started) return;
      started = true;
      const generation = ++epoch;
      const controller = new AbortController();
      startupController = controller;
      const isCurrent = () => started && epoch === generation;
      set({ready: false, failed: false, session: null, loadingRun: null});
      onNavigate = callbacks.onNavigate || (() => {});
      try {
        const remotePromise = Promise.resolve().then(() => loadCatalog({signal: controller.signal})).then(value => ({value: normalizeCatalog(value)})).catch(error => ({error}));
        // A restart opens the library after already accepted read/save intents.
        await stateWrites;
        if (!isCurrent()) return;
        const library = await openLibrary(notice);
        if (!started || epoch !== generation) return;
        const cachedValue = library.settings.find(item => item.id === 'catalog')?.value;
        let cached;
        try {if (cachedValue) cached = normalizeCatalog(cachedValue);} catch { /* An invalid earlier catalog cannot prevent opening saved items. */ }
        let catalog = cached, catalogFallback = false;
        if (!catalog) {
          const remote = await remotePromise;
          if (!started || epoch !== generation) return;
          if (remote.error) {
            if (!library.articles.length) throw remote.error;
            catalog = {feeds: [], categories: []}; catalogFallback = true;
            notice('The reader could not download the feed list. You can still browse the items it already has in your library. Check your connection and reload the page to try again.');
          } else {catalog = remote.value; await save('settings', [{id: 'catalog', value: catalog}]);}
        }
        if (!started || epoch !== generation) return;
        const setting = id => library.settings.find(item => item.id === id);
        const preferences = {
          preferredView: setting('listView')?.value === 'all' ? 'all' : 'unread',
          excluded: new Set(setting('excludedSources')?.value || []),
          theme: ['light', 'dark'].includes(setting('theme')?.value) ? setting('theme').value : 'auto',
          markReadOnScroll: setting('markReadOnScroll')?.enabled !== false,
        };
        set({catalog, catalogFallback, feedMap: new Map(catalog.feeds.map(feed => [feed.id, feed])), categoryMap: new Map(catalog.categories.map(category => [category.id, {...category, shortTitle: site.categoryLabels?.[category.id] || category.title}])),
          articles: new Map(library.articles.map(item => [item.id, item])), states: new Map(library.state.map(item => [item.id, item])), health: new Map(library.feeds.map(item => [item.id, item])), ...preferences});
        await prune(isCurrent);
        if (!started || epoch !== generation) return;
        const normalize = route => {
          const normalized = normalizeRoute(route, get().feedMap, get().categoryMap);
          const mode = site.capabilities?.articles === false ? 'posts' : site.capabilities?.posts === false ? 'articles' : normalized.mode;
          return mode === normalized.mode ? normalized : normalizeRoute({...normalized, mode}, get().feedMap, get().categoryMap);
        };
        navigation = createNavigation({preferredView: () => get().preferredView, normalize, apply: (route, y) => {
          const previous = get().route;
          const changed = ['mode', 'view', 'category', 'source'].some(key => previous[key] !== route[key]);
          const selectionChanged = ['mode', 'view', 'category', 'source', 'query', 'savedKind', 'unavailableOnly'].some(key => previous[key] !== route[key]);
          if (changed) {activeRun?.controller.abort(); loadingRun = null; publishRun();}
          set({route, ...(selectionChanged ? {retainedRead: new Set()} : {})});
          if (['all', 'unread'].includes(route.view) && get().preferredView !== route.view) setPreference('preferredView', route.view, {id: 'listView', value: route.view});
          onNavigate(route, y);
          if (route.article) {
            const item = get().articles.get(route.article);
            if (item && itemMode(item, get().feedMap) === 'posts') {
              navigation?.go({article: '', mode: 'posts', view: route.view === 'saved' ? 'saved' : 'all', savedKind: route.view === 'saved' ? 'posts' : route.savedKind}, {replace: true, keepScroll: true});
            } else if (item) setItemState(item.id, {read: true}, {retain: true});
          }
          if (get().ready && changed && !['saved', 'excluded'].includes(route.view)) refresh();
        }});
        navigation.start();
        if (queuedNavigation) {
          const queued = queuedNavigation; queuedNavigation = null;
          navigation.go(queued.changes, queued.options);
        }
        set({ready: true, failed: false});
        if (cached) remotePromise.then(async remote => {
          if (!started || epoch !== generation) return;
          if (remote.error) {notice('The reader could not download the latest feed list, so it is using an earlier copy. You can still browse your library. Reload the page to try again.'); return;}
          await save('settings', [{id: 'catalog', value: remote.value}]);
          if (started && epoch === generation && JSON.stringify(remote.value) !== JSON.stringify(catalog)) notice('The reader found a newer feed list. Reload the page when you’re ready to use it.');
        });
        const offline = () => {activeRun?.controller.abort(); publishRun(); notice('You’re offline. You can still read any items this reader already has in your library. Reconnect to load new items.');};
        const online = () => {notice('You’re back online. The reader can check for new items again.'); refresh();};
        const reconcile = () => {syncLibrary().then(() => {if (isCurrent()) refresh();});};
        const visibility = () => {if (!runtime.isVisible()) {activeRun?.controller.abort(); publishRun();} else reconcile();};
        removeListeners = runtime.subscribe({offline, online, visibility, tick: () => {if (runtime.isVisible()) {set({now: runtime.now()}); reconcile();}}});
        refresh();
      } catch (error) {if (started && epoch === generation) set({failed: true, notice: error.message});}
    }
    return {
      articles: new Map(), states: new Map(), health: new Map(), pending: new Map(), catalog: null, feedMap: new Map(), categoryMap: new Map(), route: {...emptyRoute},
      preferredView: 'unread', excluded: new Set(), theme: 'auto', markReadOnScroll: true,
      retainedRead: new Set(), expandedPosts: new Set(), undoRead: [], notice: '', announcement: '', backupStatus: '', session: null, loadingRun: null, ready: false, failed: false, catalogFallback: false, now: runtime.now(),
      start, refresh, syncLibrary, announce, setNotice: notice, setItemState,
      destroy() {started = false; epoch++; retryAgain = null; startupController?.abort(); activeRun?.controller.abort(); activeRun = null; loadingRun = null; removeListeners(); removeListeners = () => {}; navigation?.destroy(); navigation = null; onNavigate = () => {}; set({ready: false, session: null, loadingRun: null});},
      navigate,
      switchMode(mode) {if (navigation) navigation.switchMode(mode); else navigate({mode});},
      closeDialog() {if (navigation) navigation.close(); else {queuedNavigation = null; set(state => ({route: {...state.route, article: '', about: false, filters: false, feedList: false}}));}},
      endSearch() {navigation?.endSearch();},
      async toggleSaved(id) {await setItemState(id, current => ({saved: !current?.saved})); announce(get().states.get(id)?.saved ? 'The reader saved this item.' : 'The reader removed this item from Saved.');},
      async toggleRead(id) {await setItemState(id, current => ({read: !current?.read})); announce(get().states.get(id)?.read ? 'The reader marked this item as read.' : 'The reader marked this item as unread.');},
      markScrolled(ids) {return queueStateWrite(async () => {
        const state = get(), retainedRead = new Set(state.retainedRead);
        const {states: updates} = await updateStates(ids.filter(id => state.articles.has(id)).map(id => ({id, read: true})));
        // Navigation while a write is pending starts a new visible selection.
        if (get().route === state.route) for (const item of updates) retainedRead.add(item.id);
        commitStates(updates, {retainedRead: get().route === state.route ? retainedRead : get().retainedRead});
      });},
      bulkRead() {return queueStateWrite(async () => {
        const state = get();
        const result = await updateStates(selectItems(state).filter(item => !state.states.get(item.id)?.read).map(({id}) => ({id, read: true})));
        const previous = new Map(result.previous.map(item => [item.id, item]));
        const updates = result.states;
        const undoRead = updates.filter(item => !previous.get(item.id)?.read).map(({id}) => ({id, read: false}));
        commitStates(updates, {undoRead, retainedRead: new Set()});
      });},
      undo() {return queueStateWrite(async () => {
        const {states: updates} = await updateStates(get().undoRead);
        commitStates(updates, {undoRead: [], retainedRead: new Set()});
        announce('The reader restored each item’s previous read or unread mark.');
      });},
      revealPending() {
        const state = get(), articles = new Map(state.articles), pending = new Map(state.pending);
        for (const [id, item] of pending) if (itemMode(item, state.feedMap) === state.route.mode) {articles.set(id, item); pending.delete(id);}
        set({articles, pending}); announce('The reader added new items to the list.');
      },
      async toggleExcluded(id) {
        const excluded = new Set(get().excluded);
        if (excluded.has(id)) excluded.delete(id); else excluded.add(id);
        await setPreference('excluded', excluded, {id: 'excludedSources', value: [...excluded]});
        announce(excluded.has(id) ? 'The reader excluded this source from your feeds. Saved items remain available.' : 'The reader included this source in your feeds.');
      },
      async setTheme(value) {const theme = ['light', 'dark'].includes(value) ? value : 'auto'; await setPreference('theme', theme, {id: 'theme', value: theme}); announce(theme === 'auto' ? 'The reader now follows your device’s theme.' : `The reader now uses the ${theme === 'dark' ? 'Dark' : 'Light'} theme.`);},
      async setMarkReadOnScroll(enabled) {await setPreference('markReadOnScroll', enabled, {id: 'markReadOnScroll', enabled}); announce(enabled ? 'The reader will mark items read as you scroll past them.' : 'The reader will wait for you to mark items read.');},
      rememberReading() {if (!['saved', 'sources'].includes(get().route.view)) readingStarted.add(get().route.mode);},
      toggleExpanded(id) {const expandedPosts = new Set(get().expandedPosts); if (expandedPosts.has(id)) expandedPosts.delete(id); else expandedPosts.add(id); set({expandedPosts});},
      dismissLoading() {loadingRun = null; publishRun();},
      async exportBackup() {
        const state = await exportSnapshot(), now = new Date(runtime.now());
        set({backupStatus: 'Check your browser’s downloads for a backup of your saved items and which items you have read.'});
        return {content: JSON.stringify(readingBackup(state, site, now)), type: 'application/json', filename: `${site.storageNamespace}-${now.toISOString().slice(0, 10)}.json`};
      },
      async exportSaved() {
        const state = await exportSnapshot();
        const rows = [...state.articles.values()].filter(item => state.states.get(item.id)?.saved).sort(sortItems).map(item => ({title: item.title, source: sourceName(item, state), published: item.published, publishedDateOnly: item.publishedDateOnly, updated: item.updated, updatedDateOnly: item.updatedDateOnly, url: item.url, content: cleanText(item.html), read: state.states.get(item.id)?.read}));
        return {content: articlesCsv(rows), type: 'text/csv;charset=utf-8', filename: `${site.storageNamespace}-saved-${new Date(runtime.now()).toISOString().slice(0, 10)}.csv`};
      },
      async importBackup(file) {
        if (!file) return;
        try {
          if (file.size > 20 * 1024 * 1024) throw new Error('The reader cannot restore a backup larger than 20 MB. Choose a smaller backup.');
          let data;
          try {data = JSON.parse(await file.text());} catch {throw new Error('The reader cannot read this file as a JSON backup. Choose a file from Export reading backup.');}
          await queueStateWrite(async () => {
            const current = get();
            const restored = restoreReadingBackup(data, {states: new Map(), articles: new Map([...current.pending, ...current.articles])}, cleanText, site);
            // The storage boundary merges against current disk records in one
            // transaction, including changes made by another tab during parsing.
            const available = new Map([...current.pending, ...current.articles, ...restored.articles.map(item => [item.id, item])]);
            const result = await importItems({...restored, articles: restored.states.filter(item => item.saved && available.has(item.id)).map(item => available.get(item.id))});
            const articles = new Map(get().articles), pending = new Map(get().pending);
            for (const item of result.articles) {
              const local = articles.get(item.id) || pending.get(item.id);
              const previous = current.articles.get(item.id) || current.pending.get(item.id);
              articles.set(item.id, local && local !== previous ? local : item);
              pending.delete(item.id);
            }
            commitStates(result.states, {articles, pending, backupStatus: `The reader combined ${result.added} saved items and the backup’s read marks with your library.`});
          });
        } catch (error) {set({backupStatus: error.message});}
      },
    };
  });
  return store;
}
