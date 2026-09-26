import {messages, formatMessage, countMessage} from './localization.mjs';
import {Component, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useStore} from 'zustand';
import {flushSync} from 'react-dom';
import {selectItems, selectSources} from './reader-store.mjs';
import {itemMode} from './reader-state.mjs';
import {dateLabel} from './dates.mjs';
import {scrollReader} from './scroll-read.mjs';
import {containDialogTouch, download, focusedItem, focusControl} from './ui-effects.mjs';
import {StoryCard, SourceCard, categoryName} from './components/items.jsx';
import {ReaderDialogs} from './components/dialogs.jsx';

function headingFor({view, mode, unavailableOnly}) {
  return view === 'excluded' ? messages.common.excludedSources : view === 'saved' ? messages.common.savedItems : view === 'sources' ? unavailableOnly ? messages.common.unavailableSources : mode === 'posts' ? messages.common.accounts : messages.common.publications : formatMessage(view === 'unread' ? messages.headings.unread : messages.headings.latest, {kind: messages.kinds[mode]});
}

const checkedTime = new Intl.DateTimeFormat(messages.locale, {hour: 'numeric', minute: '2-digit'});
const checkedDay = new Intl.DateTimeFormat(messages.locale, {month: 'short', day: 'numeric'});

// Capture browser geometry immediately before React changes the list. Stable keys
// preserve controls; when a row disappears, restore focus to its next neighbour.
class ReadingViewport extends Component {
  getSnapshotBeforeUpdate(previous) {
    const {state} = this.props;
    if (previous.state === state || state.retainedRead.size > previous.state.retainedRead.size) return null;
    if (previous.state.articles === state.articles && previous.state.states === state.states
      && previous.state.route === state.route && previous.state.expandedPosts === state.expandedPosts
      && previous.state.pending === state.pending && previous.state.excluded === state.excluded
      && previous.state.notice === state.notice && previous.state.undoRead === state.undoRead
      && Boolean(previous.state.loadingRun) === Boolean(state.loadingRun)) return null;
    const selection = route => JSON.stringify([route.mode, route.view, route.category, route.source, route.query, route.savedKind, route.unavailableOnly]);
    const same = selection(previous.state.route) === selection(state.route);
    const anchor = same && scrollY > 0 ? [...document.querySelectorAll('#stories .story')].map(card => ({id: card.dataset.article, ...pickBounds(card)})).find(card => card.bottom > 60 && card.top < innerHeight && (state.route.view !== 'unread' || !state.states.get(card.id)?.read)) : null;
    return {focus: focusedItem(), focusedElement: document.activeElement, anchor};
  }
  componentDidUpdate(previous, previousState, snapshot) {
    if (!snapshot) return;
    if (snapshot.focus && snapshot.focusedElement !== document.activeElement && !document.querySelector('dialog[open]')) focusControl(snapshot.focus);
    if (snapshot.anchor) {
      const card = [...document.querySelectorAll('#stories .story')].find(card => card.dataset.article === snapshot.anchor.id);
      const delta = card ? card.getBoundingClientRect().top - snapshot.anchor.top : 0;
      // Even scrollBy(0, 0) interrupts native momentum scrolling on phones.
      // Read marks keep rows in place, so only compensate for a real shift.
      if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
    }
  }
  render() {return this.props.children;}
}
function pickBounds(node) {const {top, bottom} = node.getBoundingClientRect(); return {top, bottom};}

function Header({state, site, menuOpen, setMenuOpen, compact, onSearch, children}) {
  const header = useRef(null);
  useLayoutEffect(() => {
    const views = header.current.querySelector('#library-views');
    const measure = () => header.current.style.setProperty('--library-view-width', `${views.getBoundingClientRect().width}px`);
    const observer = new ResizeObserver(measure);
    measure(); observer.observe(views);
    return () => observer.disconnect();
  }, []);
  const {mode, view, query} = state.route;
  const current = [...state.articles.values()].filter(item => itemMode(item, state.feedMap) === mode);
  const savedCount = [...state.articles.keys()].filter(id => state.states.get(id)?.saved).length;
  const searchLabel = view === 'excluded' ? messages.search.excluded : view === 'saved' ? messages.search.saved : view === 'sources' ? formatMessage(messages.search.sources, {kind: messages.kinds[mode === 'posts' ? 'accounts' : 'publications']}) : formatMessage(messages.search.items, {kind: messages.kinds[mode]});
  const navigate = state.navigate;
  const open = key => navigate({[key]: true, limit: state.route.limit}, {keepScroll: true});
  const separator = site.name.indexOf('&');
  const before = separator < 0 ? site.name : site.name.slice(0, separator);
  const after = separator < 0 ? undefined : site.name.slice(separator + 1);
  return <div ref={header} className={`reader-header${menuOpen ? ' menu-open' : ''}${compact ? ' compact' : ''}`} id="reader-header">
    <header className="masthead">
      <a className="wordmark" href="./" aria-label={site.homeLabel} onClick={event => {if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate({mode: site.capabilities.articles ? 'articles' : 'posts', view: state.preferredView, source: '', category: '', query: '', unavailableOnly: false});}}>
        <img className="brand-icon" src={site.assets.logo} width="48" height="48" alt=""/><span className="brand-copy"><span className="brand-name">{after === undefined ? site.name : <>{before}<i>&amp;</i>{after}</>}</span><small>{site.tagline}</small></span>
      </a>
      <button id="menu-toggle" className="icon-button" aria-label={menuOpen ? messages.common.closeMenu : messages.common.openMenu} aria-expanded={menuOpen} aria-controls="resource-menu" onClick={() => setMenuOpen(!menuOpen)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
      <nav id="resource-menu" aria-label={messages.common.resources}>
        <button id="publications-button" className="text-button" onClick={() => navigate({view: 'sources', source: '', category: '', query: '', unavailableOnly: false})}>{mode === 'posts' ? messages.common.accounts : messages.common.publications}</button>
        <button id="menu-filter-button" className="text-button" onClick={() => navigate({view: ['all', 'unread'].includes(view) ? view : state.preferredView, filters: true, limit: state.route.limit}, {keepScroll: true})}>{messages.reader.filterFeeds}</button>
        <button id="excluded-button" className="text-button" onClick={() => navigate({view: 'excluded', source: '', category: '', query: '', unavailableOnly: false})}>{messages.common.excludedSources}{' '}<span id="excluded-count" className="count">{state.excluded.size}</span></button>
        <label className="theme-control" htmlFor="theme">{messages.common.theme}{' '}<select id="theme" value={state.theme} onChange={event => state.setTheme(event.target.value)}><option value="auto">{messages.common.auto}</option><option value="light">{messages.common.light}</option><option value="dark">{messages.common.dark}</option></select></label>
        <button id="about-button" className="text-button" onClick={() => open('about')}>{messages.common.aboutThisReader}</button>
        {site.opmlUrl && <button id="feed-list-button" className="text-button" aria-haspopup="dialog" aria-controls="feed-list-dialog" onClick={() => open('feedList')}>{messages.common.downloadFeedList}</button>}
        {site.repository && <a id="github-link" href={site.repository}>{messages.reader.gitHub}</a>}
      </nav>
    </header>
    <div className="mode-bar"><nav aria-label={messages.navigation.readingMode} className="mode-switch">{['articles', 'posts'].filter(kind => site.capabilities[kind]).map(kind => <button key={kind} data-mode={kind} aria-pressed={['all', 'unread'].includes(view) && mode === kind} onClick={() => state.switchMode(kind)}>{kind === 'articles' ? messages.common.articles : messages.common.posts}</button>)}</nav><button id="saved-button" data-view="saved" aria-pressed={view === 'saved'} onClick={() => navigate({view: 'saved', savedKind: 'all', source: '', category: '', query: '', unavailableOnly: false})}>{messages.common.saved}{' '}<span id="saved-count" className="count">{savedCount}</span></button></div>
    <div className="header-tools"><nav id="library-views" className="view-nav" aria-label={mode === 'posts' ? messages.navigation.postView : messages.navigation.articleView}>{[['all', messages.common.latest, current.length], ['unread', messages.common.unread, current.filter(item => !state.states.get(item.id)?.read).length]].map(([kind, label, count]) => <button key={kind} data-view={kind} aria-pressed={view === kind} onClick={() => navigate({view: kind, unavailableOnly: false})}>{label} <span id={`${kind}-count`} className="count sr-only">{count}</span></button>)}</nav>
      <div id="search-panel"><div className="search"><span className="sr-only" id="search-label">{searchLabel}</span><input id="search" type="search" placeholder={formatMessage(messages.search.placeholder, {label: searchLabel})} aria-labelledby="search-label" aria-describedby="search-help" value={query} onChange={event => onSearch(event.target.value, {search: true})} onKeyDown={event => {if (event.key === 'Enter' && !event.nativeEvent.isComposing) {event.preventDefault(); onSearch(query, {search: true});}}} onBlur={state.endSearch}/><button id="clear-search" type="button" aria-label={messages.search.clear} hidden={!query} onClick={() => {onSearch(''); document.querySelector('#search').focus({preventScroll: true}); state.announce(messages.announcements.searchCleared);}}>×</button></div><p id="search-help" className="sr-only">{view === 'excluded' ? messages.search.excludedHint : view === 'sources' ? formatMessage(messages.search.sourceHint, {kind: messages.kinds[mode === 'posts' ? 'accounts' : 'publications']}) : messages.search.itemsHint}</p></div>
      <button id="filter-button" className="icon-button" aria-label={messages.common.filters} title={messages.common.filters} aria-haspopup="dialog" hidden={['saved', 'excluded'].includes(view)} onClick={() => open('filters')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg></button>
    </div>
    <div className="header-status">{children}</div>
  </div>;
}

function FeedStatus({state, pendingCount, onReveal, children}) {
  const {view, mode} = state.route;
  const run = state.loadingRun?.mode === mode && view !== 'saved' ? state.loadingRun : null;
  const visible = Boolean(run || pendingCount);
  const active = Boolean(run && !run.finished && !run.controller.signal.aborted);
  const checking = Boolean(state.session && state.session.mode === mode && !state.session.controller.signal.aborted && view !== 'saved');
  const feeds = selectSources(state, true), failures = feeds.filter(feed => state.health.get(feed.id)?.error);
  const attempts = feeds.map(feed => state.health.get(feed.id)?.lastAttempt || state.health.get(feed.id)?.lastSuccess || 0).filter(Boolean);
  const lastChecked = attempts.length ? Math.max(...attempts) : 0;
  const checkedLabel = lastChecked ? formatMessage(messages.loading.checked, {date: dateLabel(lastChecked, true)}) : messages.loading.notCheckedYet;
  const compactChecked = lastChecked ? formatMessage(messages.loading.checked, {date: (new Date(lastChecked).toDateString() === new Date(state.now).toDateString() ? checkedTime : checkedDay).format(lastChecked)}) : messages.loading.notChecked;
  const label = view === 'sources' ? messages.common.sources : mode === 'posts' ? messages.common.posts : messages.common.articles;
  return <>
    <div id="feed-loading" className="feed-loading" hidden={!visible} data-state={active ? 'loading' : 'finished'} data-pending={pendingCount > 0}>
      <div className="loading-copy"><div className="loading-heading"><span className="loading-symbol" aria-hidden="true"><span className="sk-flow"><span className="sk-flow-dot"/><span className="sk-flow-dot"/><span className="sk-flow-dot"/></span><span className="loading-mark">{!run || run.completed ? '✓' : 'Ⅱ'}</span></span><strong id="loading-label" hidden={pendingCount > 0}>{label}</strong><button id="new-items" className="new-items" hidden={!pendingCount} disabled={active} onClick={onReveal}>{countMessage((active ? messages.newItems : messages.showNewItems)[mode], pendingCount)}</button><span id="loading-count" hidden={!run}><span id="loading-count-value">{run ? `${String(run.done).padStart(String(run.total).length, '\u2007')} / ${run.total}` : ''}</span><span>{messages.loading.feeds}</span></span></div>
        <div className="loading-messages sr-only"><p id="loading-guidance" aria-hidden={!active}>{view === 'sources' ? messages.loading.checkingAvailability : messages.loading.waitToRead}</p><p id="loading-result" aria-hidden={active}>{!run || run.completed ? view === 'sources' ? messages.loading.sourcesChecked : messages.loading.ready : messages.loading.paused}</p></div>
      </div>
      <button id="dismiss-loading" className="loading-dismiss" aria-label={messages.loading.dismiss} hidden={pendingCount > 0} disabled={active} onClick={() => {state.dismissLoading(); document.querySelector('#refresh').focus({preventScroll: true});}}>×</button>
      <progress id="loading-bar" hidden={!run} max={run?.total || 1} value={run?.done || 0} aria-label={active ? view === 'sources' ? messages.loading.checkingSources : formatMessage(messages.loading.label, {kind: messages.kinds[mode]}) : run?.completed ? messages.loading.completeLabel : messages.loading.pausedLabel} aria-valuetext={formatMessage(messages.loading.progress, {done: run?.done || 0, total: run?.total || 0})} aria-describedby={active ? 'loading-guidance' : 'loading-result'}/>
    </div>
    <div className="status-row"><div id="feed-progress" className="feed-progress">{view === 'saved' ? <span>{messages.loading.savedDescription}</span> : <>
      {!checking && <span className="checked-at" hidden={visible} title={checkedLabel}><span className="status-full">{checkedLabel}</span><span className="status-compact" aria-hidden="true">{compactChecked}</span></span>}
      {failures.length > 0 && <button className="text-button status-link" onClick={() => state.navigate({view: 'sources', unavailableOnly: true, source: '', category: '', query: ''})}>{formatMessage(messages.loading.unavailable, {count: failures.length})}</button>}
    </>}</div>{children}<button id="refresh" className="text-button" aria-label={messages.common.refresh} title={checking ? messages.loading.checkingFeeds : messages.common.refresh} aria-busy={checking} hidden={['saved', 'excluded'].includes(view)} disabled={checking} onClick={() => state.refresh({retryFailed: true, resetList: true})}><span className="refresh-symbol" aria-hidden="true">↻</span><span className="status-action-label">{checking ? messages.loading.checkingAction : messages.loading.refreshAction}</span></button></div>
  </>;
}

function EmptyState({title, children}) {return <div className="empty-state"><h2 tabIndex={-1}>{title}</h2><p>{children}</p></div>;}

function ListContent({state, site, items, sources}) {
  const {view, mode, query, category, source, savedKind} = state.route;
  if (state.failed) return <EmptyState title={messages.empty.catalogError}>{messages.empty.reloadHint}{site.opmlUrl && messages.empty.downloadHint}</EmptyState>;
  if (!state.ready) return <EmptyState title={messages.empty.openingLibrary}>{messages.empty.checkingStorage}</EmptyState>;
  if (['sources', 'excluded'].includes(view)) return sources.length ? sources.map(feed => <SourceCard key={feed.id} feed={feed} state={state}/>) : <EmptyState title={view === 'excluded' && !query ? messages.empty.noExcluded : messages.empty.noSources}>{view === 'excluded' ? messages.empty.excludedHint : messages.empty.sourcesHint}</EmptyState>;
  if (items.length) return items.slice(0, state.route.limit).map(item => <StoryCard key={item.id} item={item} state={state} site={site}/>);
  const anySaved = [...state.states.values()].some(mark => mark.saved && state.articles.has(mark.id));
  const active = state.session && state.session.mode === mode && view !== 'saved';
  const filtered = query || category || source || (view === 'saved' && savedKind !== 'all');
  const title = view === 'saved' ? anySaved ? messages.empty.noSavedMatches : messages.empty.noSaved : active ? formatMessage(messages.loading.empty, {kind: messages.kinds[mode]}) : filtered ? messages.empty.noMatches : view === 'unread' ? messages.empty.caughtUp : messages.empty.noItems;
  return <EmptyState title={title}>{view === 'saved' && !anySaved ? messages.empty.savedHint : filtered ? messages.empty.filteredHint : active ? messages.empty.loadingHint : messages.empty.refreshHint}</EmptyState>;
}

export function App({store, site, navigationPosition}) {
  const state = useStore(store), {route} = state;
  const [menuOpen, setMenuOpen] = useState(false), [scrollState, setScrollState] = useState({compact: window.scrollY > 100, top: window.scrollY >= 500});
  const headerPosition = useRef({y: window.scrollY, restoredY: null, initialized: false});
  const scrolling = useRef(null), stories = useRef(null);
  const announcedRoute = useRef(route);
  const items = useMemo(() => selectItems(state), [state.articles, state.states, state.route, state.feedMap, state.excluded, state.retainedRead]);
  const sourceView = ['sources', 'excluded'].includes(route.view);
  const sources = (route.view === 'excluded' ? [...state.excluded].map(id => state.feedMap.get(id) || {id, name: id, description: messages.sources.removedDescription}) : selectSources(state)).filter(feed => (!route.unavailableOnly || state.health.get(feed.id)?.error) && (!route.query || `${feed.name} ${feed.description}`.toLocaleLowerCase().includes(route.query.trim().toLocaleLowerCase()))).sort((a, b) => a.name.localeCompare(b.name));
  const pendingCount = ['all', 'unread'].includes(route.view) ? selectItems({...state, articles: state.pending}, {retainRead: false}).length : 0;
  const unread = items.filter(item => !state.states.get(item.id)?.read).length;
  const savedCount = [...state.articles.keys()].filter(id => state.states.get(id)?.saved).length;
  const result = state.failed ? messages.announcements.libraryError : !state.ready ? messages.announcements.openingLibrary : sourceView ? countMessage(messages.counts[route.unavailableOnly ? 'unavailable' : 'sources'], sources.length) : formatMessage(messages.reader.sortedCount, {items: countMessage(messages.counts[route.view === 'saved' ? 'saved' : route.mode], items.length)});
  const active = Boolean(state.loadingRun && state.loadingRun.mode === route.mode && route.view !== 'saved' && !state.loadingRun.finished && !state.loadingRun.controller.signal.aborted);
  const heading = headingFor(route);
  useEffect(() => {
    const previous = announcedRoute.current;
    announcedRoute.current = route;
    // Announce deliberate selection changes without repeating counts for every
    // feed response or overwriting save/read confirmations on unrelated updates.
    if (state.ready && ['mode', 'view', 'category', 'source', 'query', 'savedKind', 'unavailableOnly'].some(key => previous[key] !== route[key])) store.getState().announce(result);
  }, [route, state.ready, store, result]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = state.theme === 'dark' || (state.theme === 'auto' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.palette = site.theme;
      document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [state.theme, site.theme]);
  useEffect(() => {
    const closeMenu = () => {
      if (document.querySelector('#resource-menu')?.contains(document.activeElement) && matchMedia('(max-width: 760px)').matches) document.querySelector('#menu-toggle').focus({preventScroll: true});
      setMenuOpen(false);
    };
    const click = event => {if (!event.target.closest('.masthead')) closeMenu(); if (!event.target.closest('#reading-options')) document.querySelector('#reading-options').open = false;};
    const focus = event => {if (!event.target.closest('.masthead')) closeMenu();};
    const key = event => {document.documentElement.classList.remove('pointer-navigation'); if (event.key === 'Escape') {closeMenu(); document.querySelector('#reading-options').open = false;}};
    const pointer = () => document.documentElement.classList.add('pointer-navigation');
    const scroll = () => {
      const y = window.scrollY, position = headerPosition.current;
      const restored = position.restoredY !== null && Math.abs(y - position.restoredY) < 1;
      if (!restored) position.restoredY = null;
      // Restoring a tab's position must not resize its controls. Once scrolling
      // resumes, expand near the top only when moving up, not down a fresh tab.
      flushSync(() => setScrollState(previous => {
        const compact = restored ? previous.compact : y > 100 ? true : y < position.y || y <= 0 ? false : previous.compact;
        const top = y >= 500;
        return previous.compact === compact && previous.top === top ? previous : {compact, top};
      }));
      position.y = y;
      if (window.scrollY > 200 && !document.querySelector('dialog[open]')) store.getState().rememberReading();
    };
    document.addEventListener('click', click); document.addEventListener('focusin', focus); document.addEventListener('keydown', key); document.addEventListener('pointerdown', pointer, true); window.addEventListener('scroll', scroll, {passive: true});
    const releaseTouch = containDialogTouch();
    return () => {releaseTouch(); document.removeEventListener('click', click); document.removeEventListener('focusin', focus); document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', pointer, true); window.removeEventListener('scroll', scroll);};
  }, [store]);
  useLayoutEffect(() => {
    scrolling.current = scrollReader(stories.current, ids => store.getState().markScrolled(ids));
    return () => scrolling.current.destroy();
  }, [store]);
  useLayoutEffect(() => {scrolling.current?.setEnabled(state.markReadOnScroll);}, [state.markReadOnScroll]);
  useLayoutEffect(() => {
    document.title = formatMessage(messages.reader.documentTitle, {heading, name: site.name});
    setMenuOpen(false);
    document.querySelector('#reading-options').open = false;
    const position = navigationPosition.current;
    if (position) {
      window.scrollTo({top: position.y, behavior: 'instant'});
      const y = window.scrollY, initial = !headerPosition.current.initialized;
      headerPosition.current = {y, restoredY: y, initialized: true};
      setScrollState(previous => ({compact: initial ? y > 100 : previous.compact, top: y >= 500}));
      navigationPosition.current = null;
    }
    scrolling.current?.sync();
  }, [route]);
  useLayoutEffect(() => {scrolling.current?.sync();}, [state.articles, state.pending, route.limit]);
  const backToTop = () => {
    headerPosition.current.restoredY = null;
    setScrollState({compact: false, top: false});
    window.scrollTo({top: 0, behavior: 'instant'});
    scrolling.current?.sync();
  };
  const revealNew = () => {
    flushSync(() => {state.revealPending(); state.dismissLoading();});
    backToTop();
    document.querySelector('#heading').focus({preventScroll: true});
  };
  const search = (query, options) => {
    flushSync(() => state.navigate({query}, options));
    backToTop();
  };
  const filterActive = route.category || route.source || route.query;
  return <>
    <a className="skip-link" href="#main" onClick={event => {event.preventDefault(); document.querySelector('#main').focus();}}>{messages.reader.skipToStories}</a>
    <Header state={state} site={site} menuOpen={menuOpen} setMenuOpen={setMenuOpen} compact={scrollState.compact} onSearch={search}>
      <FeedStatus state={state} pendingCount={pendingCount} onReveal={revealNew}><details id="reading-options" hidden={['sources', 'saved', 'excluded'].includes(route.view)}><summary aria-label={messages.reading.options} title={messages.reading.options}><svg className="status-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h4m4 0h10M3 17h10m4 0h4"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></svg><span className="status-action-label">{messages.reading.options}</span></summary><div className="options-content"><label className="scroll-read-control"><input id="scroll-read" type="checkbox" checked={state.markReadOnScroll} onChange={event => state.setMarkReadOnScroll(event.target.checked)}/>{messages.reading.markOnScroll}</label><button id="mark-read" className="secondary-button" disabled={!unread} onClick={async () => {await state.bulkRead(); document.querySelector('#reading-options').open = false; document.querySelector('#undo-read').focus({preventScroll: true});}}>{formatMessage(messages.reading.markAll, {count: unread.toLocaleString(messages.locale), kind: messages.kinds[route.mode]})}</button><p className="hint">{messages.reading.markAllHint}</p></div></details></FeedStatus>
    </Header>
    <ReadingViewport state={state}><main id="main" tabIndex={-1}>
      <section id="page-heading" className={`page-heading${!['saved', 'sources', 'excluded'].includes(route.view) ? ' sr-only' : ''}`}><h1 id="heading" tabIndex={-1}>{heading}</h1><p id="description" hidden/></section>
      <nav id="saved-kinds" className="view-nav" aria-label={messages.navigation.savedKind} hidden={route.view !== 'saved'}>{['all', 'articles', 'posts'].map(kind => <button key={kind} data-kind={kind} aria-pressed={route.savedKind === kind} onClick={() => state.navigate({savedKind: kind})}>{kind === 'all' ? messages.common.all : kind === 'articles' ? messages.common.articles : messages.common.posts}</button>)}</nav>
      <div id="filter-chips" className="filter-chips" aria-label={messages.filters.active} hidden={!filterActive}>
        {route.category && <button className="filter-chip" onClick={() => state.navigate({category: ''})}>{categoryName(route.category, state)} ×</button>}
        {route.source && <button className="filter-chip" onClick={() => state.navigate({source: ''})}>{state.feedMap.get(route.source)?.name} ×</button>}
        {route.query && <button className="filter-chip" onClick={() => state.navigate({query: ''})}>{formatMessage(messages.search.chip, {query: route.query})}</button>}
        {filterActive && <button className="text-button" onClick={() => state.navigate({category: '', source: '', query: ''})}>{messages.filters.clear}</button>}
      </div>
      {route.query && !sourceView && <p className="hint search-scope">{messages.search.scope}</p>}
      <div className="reading-utility" hidden={route.view !== 'saved'}><button id="export-saved" className="text-button download-link" hidden={route.view !== 'saved'} disabled={!savedCount} aria-label={messages.exports.csvLabel} onClick={async () => download(await state.exportSaved())}>{messages.exports.csv}</button></div>
      <div className="reading-bar"><span id="result-label" className="sr-only">{result}</span><button id="show-all-sources" className="text-button" hidden={route.view !== 'sources' || !route.unavailableOnly} onClick={() => state.navigate({unavailableOnly: false, category: '', source: '', query: ''})}>{messages.sources.showAll}</button></div>
      <div id="notice" className="notice" role="status" hidden={!state.notice}>{state.notice}</div>
      <div id="undo-bar" className="notice" hidden={!state.undoRead.length}><span id="undo-message" role="status">{formatMessage(messages.reading.marked, {count: state.undoRead.length, kind: messages.kinds[route.mode]})}</span><div className="undo-actions"><button id="undo-read" className="text-button" onClick={async () => {await state.undo(); document.querySelector('#heading').focus({preventScroll: true});}}>{messages.common.undo}</button><button id="dismiss-undo" className="icon-button" aria-label={messages.reading.dismissConfirmation} title={messages.reading.dismissConfirmation} onClick={() => {state.dismissUndo(); document.querySelector('#heading').focus({preventScroll: true});}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>
      <p id="announcement" className="sr-only" role="status" aria-live="polite">{state.announcement}</p>
      <section id="stories" ref={stories} className={sourceView ? 'source-grid' : ''} aria-label={route.view === 'saved' ? messages.common.savedItems : sourceView ? messages.common.sources : route.mode === 'posts' ? messages.common.posts : messages.common.articles} aria-busy={active} aria-describedby={active ? 'loading-guidance' : undefined} onPointerDown={state.rememberReading} onKeyDown={state.rememberReading}><ListContent state={state} site={site} items={items} sources={sources}/></section>
      <button id="load-more" className="load-more" hidden={sourceView || items.length <= route.limit} onClick={() => state.navigate({limit: route.limit + 60}, {replace: true, keepScroll: true})}>{messages.reader.showMore}</button>
      <footer className="reader-footer">{site.repository && <a href={site.repository}>{formatMessage(messages.reader.repository, {name: state.catalog?.title || site.name})}</a>}</footer>
    </main></ReadingViewport>
    <button id="back-to-top" className="secondary-button" hidden={!scrollState.top} onClick={() => {backToTop(); document.querySelector('.wordmark').focus({preventScroll: true});}}>{messages.reader.backToTop}</button>
    <ReaderDialogs state={state} site={site}/>
  </>;
}
