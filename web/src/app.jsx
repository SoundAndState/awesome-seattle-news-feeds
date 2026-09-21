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
  return view === 'excluded' ? 'Excluded sources' : view === 'saved' ? 'Saved items' : view === 'sources' ? unavailableOnly ? 'Unavailable sources' : mode === 'posts' ? 'Accounts' : 'Publications' : `${view === 'unread' ? 'Unread' : 'Latest'} ${mode}`;
}

const counted = (count, plural) => `${count.toLocaleString()} ${count === 1 ? plural.slice(0, -1) : plural}`;

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
    return {focus: focusedItem(), anchor};
  }
  componentDidUpdate(previous, previousState, snapshot) {
    if (!snapshot) return;
    if (snapshot.focus && !document.querySelector('dialog[open]')) focusControl(snapshot.focus);
    if (snapshot.anchor) {
      const card = [...document.querySelectorAll('#stories .story')].find(card => card.dataset.article === snapshot.anchor.id);
      if (card) window.scrollBy(0, card.getBoundingClientRect().top - snapshot.anchor.top);
    }
  }
  render() {return this.props.children;}
}
function pickBounds(node) {const {top, bottom} = node.getBoundingClientRect(); return {top, bottom};}

function Header({state, site, menuOpen, setMenuOpen, compact, children}) {
  const {mode, view, query} = state.route;
  const current = [...state.articles.values()].filter(item => itemMode(item, state.feedMap) === mode);
  const savedCount = [...state.articles.keys()].filter(id => state.states.get(id)?.saved).length;
  const searchLabel = view === 'excluded' ? 'Search excluded sources' : view === 'saved' ? 'Search saved items' : view === 'sources' ? `Search ${mode === 'posts' ? 'accounts' : 'publications'}` : `Search ${mode}`;
  const navigate = state.navigate;
  const open = key => navigate({[key]: true, limit: state.route.limit}, {keepScroll: true});
  const separator = site.name.indexOf('&');
  const before = separator < 0 ? site.name : site.name.slice(0, separator);
  const after = separator < 0 ? undefined : site.name.slice(separator + 1);
  return <div className={`reader-header${menuOpen ? ' menu-open' : ''}${compact ? ' compact' : ''}`} id="reader-header">
    <header className="masthead">
      <a className="wordmark" href="./" aria-label={site.homeLabel} onClick={event => {if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate({mode: site.capabilities.articles ? 'articles' : 'posts', view: state.preferredView, source: '', category: '', query: '', unavailableOnly: false});}}>
        <img className="brand-icon" src={site.assets.logo} width="48" height="48" alt=""/><span className="brand-copy"><span className="brand-name">{after === undefined ? site.name : <>{before}<i>&amp;</i>{after}</>}</span><small>{site.tagline}</small></span>
      </a>
      <button id="menu-toggle" className="icon-button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="resource-menu" onClick={() => setMenuOpen(!menuOpen)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
      <nav id="resource-menu" aria-label="Resources">
        <button id="publications-button" className="text-button" onClick={() => navigate({view: 'sources', source: '', category: '', query: '', unavailableOnly: false})}>{mode === 'posts' ? 'Accounts' : 'Publications'}</button>
        <button id="menu-filter-button" className="text-button" onClick={() => navigate({view: ['all', 'unread'].includes(view) ? view : state.preferredView, filters: true, limit: state.route.limit}, {keepScroll: true})}>Filter feeds</button>
        <button id="excluded-button" className="text-button" onClick={() => navigate({view: 'excluded', source: '', category: '', query: '', unavailableOnly: false})}>Excluded sources <span id="excluded-count" className="count">{state.excluded.size}</span></button>
        <label className="theme-control" htmlFor="theme">Theme <select id="theme" value={state.theme} onChange={event => state.setTheme(event.target.value)}><option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <button id="about-button" className="text-button" onClick={() => open('about')}>About this reader</button>
        {site.opmlUrl && <button id="feed-list-button" className="text-button" aria-haspopup="dialog" aria-controls="feed-list-dialog" onClick={() => open('feedList')}>Download feed list</button>}
        {site.repository && <a id="github-link" href={site.repository}>GitHub ↗︎</a>}
      </nav>
    </header>
    <div className="mode-bar"><nav aria-label="Reading mode" className="mode-switch">{['articles', 'posts'].filter(kind => site.capabilities[kind]).map(kind => <button key={kind} data-mode={kind} aria-pressed={['all', 'unread'].includes(view) && mode === kind} onClick={() => state.switchMode(kind)}>{kind === 'articles' ? 'Articles' : 'Posts'}</button>)}</nav><button id="saved-button" data-view="saved" aria-pressed={view === 'saved'} onClick={() => navigate({view: 'saved', savedKind: 'all', source: '', category: '', query: '', unavailableOnly: false})}>Saved <span id="saved-count" className="count">{savedCount}</span></button></div>
    <div className="header-tools"><nav id="library-views" className="view-nav" aria-label={mode === 'posts' ? 'Post view' : 'Article view'}>{[['all', 'Latest', current.length], ['unread', 'Unread', current.filter(item => !state.states.get(item.id)?.read).length]].map(([kind, label, count]) => <button key={kind} data-view={kind} aria-pressed={view === kind} onClick={() => navigate({view: kind, unavailableOnly: false})}>{label} <span id={`${kind}-count`} className="count sr-only">{count}</span></button>)}</nav>
      <div id="search-panel"><div className="search"><span className="sr-only" id="search-label">{searchLabel}</span><input id="search" type="search" placeholder={`${searchLabel}…`} aria-labelledby="search-label" aria-describedby="search-help" value={query} onChange={event => navigate({query: event.target.value}, {search: true})} onBlur={state.endSearch}/><button id="clear-search" type="button" aria-label="Clear search" hidden={!query} onClick={() => {navigate({query: ''}); document.querySelector('#search').focus(); state.announce('Search cleared.');}}>×</button></div><p id="search-help" className="sr-only">{view === 'excluded' ? 'Search the sources you have excluded.' : view === 'sources' ? `Search the ${mode === 'posts' ? 'accounts' : 'publications'} in this list.` : 'Search the items this reader has loaded in your current view.'}</p></div>
      <button id="filter-button" className="icon-button" aria-label="Filters" title="Filters" aria-haspopup="dialog" hidden={['saved', 'excluded'].includes(view)} onClick={() => open('filters')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg></button>
    </div>
    <div className="header-status">{children}</div>
  </div>;
}

function FeedStatus({state, children}) {
  const {view, mode} = state.route, run = state.loadingRun;
  const visible = Boolean(run && run.mode === mode && view !== 'saved');
  const active = visible && !run.finished && !run.controller.signal.aborted;
  const checking = Boolean(state.session && state.session.mode === mode && !state.session.controller.signal.aborted && view !== 'saved');
  const feeds = selectSources(state, true), failures = feeds.filter(feed => state.health.get(feed.id)?.error);
  const attempts = feeds.map(feed => state.health.get(feed.id)?.lastAttempt || state.health.get(feed.id)?.lastSuccess || 0).filter(Boolean);
  const label = view === 'sources' ? 'Sources' : mode === 'posts' ? 'Posts' : 'Articles';
  return <>
    <div id="feed-loading" className="feed-loading" hidden={!visible} data-state={active ? 'loading' : 'finished'}>
      <div className="loading-copy"><div className="loading-heading"><span className="loading-symbol" aria-hidden="true"><span className="sk-flow"><span className="sk-flow-dot"/><span className="sk-flow-dot"/><span className="sk-flow-dot"/></span><span className="loading-mark">{run?.completed ? '✓' : 'Ⅱ'}</span></span><strong id="loading-label">{label}</strong><span id="loading-count"><span id="loading-count-value">{run ? `${String(run.done).padStart(String(run.total).length, '\u2007')} / ${run.total}` : ''}</span><span>feeds</span></span></div>
        <div className="loading-messages"><p id="loading-guidance" aria-hidden={!active}>{view === 'sources' ? 'Checking availability.' : 'Wait to start reading.'}</p><p id="loading-result" aria-hidden={active}>{run?.completed ? view === 'sources' ? 'Sources checked.' : 'Ready to read.' : 'Check paused.'}</p></div>
      </div>
      <button id="dismiss-loading" className="loading-dismiss" aria-label="Dismiss feed status" disabled={active} onClick={() => {state.dismissLoading(); document.querySelector('#refresh').focus({preventScroll: true});}}>×</button>
      <progress id="loading-bar" max={run?.total || 1} value={run?.done || 0} aria-label={active ? view === 'sources' ? 'Checking sources' : `Loading ${mode}` : run?.completed ? 'Feed check complete' : 'Feed check paused'} aria-valuetext={`${run?.done || 0} of ${run?.total || 0} feeds checked`} aria-describedby={active ? 'loading-guidance' : 'loading-result'}/>
    </div>
    <div className="status-row"><div id="feed-progress" className="feed-progress">{view === 'saved' ? <span>Your saved articles and posts</span> : <>
      {!checking && <span hidden={visible}>{attempts.length ? `Checked ${dateLabel(Math.max(...attempts), true)}` : 'Feeds not checked yet.'}</span>}
      {failures.length > 0 && <button className="text-button status-link" onClick={() => state.navigate({view: 'sources', unavailableOnly: true, source: '', category: '', query: ''})}>{failures.length} unavailable</button>}
    </>}</div>{children}<button id="refresh" className="text-button" aria-label="Refresh" hidden={['saved', 'excluded'].includes(view)} disabled={checking} onClick={() => state.refresh({retryFailed: true, resetList: true})}>{checking ? '↻ Checking' : '↻ Refresh'}</button></div>
  </>;
}

function EmptyState({title, children}) {return <div className="empty-state"><h2 tabIndex={-1}>{title}</h2><p>{children}</p></div>;}

function ListContent({state, site, items, sources}) {
  const {view, mode, query, category, source, savedKind} = state.route;
  if (state.failed) return <EmptyState title="The reader could not load the feed list.">Check your connection and reload the page.{site.opmlUrl && ' You can also choose Download feed list to use another reader.'}</EmptyState>;
  if (!state.ready) return <EmptyState title="Opening your library…">The reader checks this browser for previously stored items.</EmptyState>;
  if (['sources', 'excluded'].includes(view)) return sources.length ? sources.map(feed => <SourceCard key={feed.id} feed={feed} state={state}/>) : <EmptyState title={view === 'excluded' && !query ? 'No excluded sources.' : 'No sources match.'}>{view === 'excluded' ? 'Select a publisher’s name in the feed to exclude a source, or clear your search.' : 'Clear your filters to see more sources.'}</EmptyState>;
  if (items.length) return items.slice(0, state.route.limit).map(item => <StoryCard key={item.id} item={item} state={state} site={site}/>);
  const anySaved = [...state.states.values()].some(mark => mark.saved && state.articles.has(mark.id));
  const active = state.session && state.session.mode === mode && view !== 'saved';
  const filtered = query || category || source || (view === 'saved' && savedKind !== 'all');
  const title = view === 'saved' ? anySaved ? 'No saved items match.' : 'You have not saved any items yet.' : active ? `Loading ${mode}…` : filtered ? 'No items match.' : view === 'unread' ? 'You’re caught up.' : 'The reader has not loaded any items yet.';
  return <EmptyState title={title}>{view === 'saved' && !anySaved ? 'Save an article or post to find it here.' : filtered ? 'Clear your filters or try another search. The reader searches only the items it has loaded in this view.' : active ? 'The reader adds items as each feed finishes loading.' : 'Choose Refresh to check for new items, or open Filters and browse sources to see which feeds could not load.'}</EmptyState>;
}

export function App({store, site, navigationPosition}) {
  const state = useStore(store), {route} = state;
  const [menuOpen, setMenuOpen] = useState(false), [scrollState, setScrollState] = useState({compact: window.scrollY > 100, top: window.scrollY >= 500});
  const scrolling = useRef(null), stories = useRef(null);
  const announcedRoute = useRef(route);
  const items = useMemo(() => selectItems(state), [state.articles, state.states, state.route, state.feedMap, state.excluded, state.retainedRead]);
  const sourceView = ['sources', 'excluded'].includes(route.view);
  const sources = (route.view === 'excluded' ? [...state.excluded].map(id => state.feedMap.get(id) || {id, name: id, description: 'This source is no longer in the catalog.'}) : selectSources(state)).filter(feed => (!route.unavailableOnly || state.health.get(feed.id)?.error) && (!route.query || `${feed.name} ${feed.description}`.toLocaleLowerCase().includes(route.query.trim().toLocaleLowerCase()))).sort((a, b) => a.name.localeCompare(b.name));
  const pendingCount = ['all', 'unread'].includes(route.view) ? selectItems({...state, articles: state.pending}, {retainRead: false}).length : 0;
  const unread = items.filter(item => !state.states.get(item.id)?.read).length;
  const savedCount = [...state.articles.keys()].filter(id => state.states.get(id)?.saved).length;
  const result = state.failed ? 'The reader could not open your library.' : !state.ready ? 'The reader is opening your library…' : sourceView ? counted(sources.length, `${route.unavailableOnly ? 'unavailable ' : ''}sources`) : `${counted(items.length, route.view === 'saved' ? 'saved items' : route.mode)} · Newest first`;
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
      // Header height affects pointer targets. Commit a threshold crossing before
      // the browser dispatches the next pointer event, including Safari taps.
      flushSync(() => setScrollState(previous => {const next = {compact: window.scrollY > 100, top: window.scrollY >= 500}; return previous.compact === next.compact && previous.top === next.top ? previous : next;}));
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
    document.title = `${heading} — ${site.name}`;
    setMenuOpen(false);
    document.querySelector('#reading-options').open = false;
    const position = navigationPosition.current;
    if (position) {window.scrollTo({top: position.y, behavior: 'instant'}); navigationPosition.current = null;}
    scrolling.current?.sync();
  }, [route]);
  useLayoutEffect(() => {scrolling.current?.sync();}, [state.articles, state.pending, route.limit]);
  const filterActive = route.category || route.source || route.query;
  return <>
    <a className="skip-link" href="#main" onClick={event => {event.preventDefault(); document.querySelector('#main').focus();}}>Skip to stories</a>
    <Header state={state} site={site} menuOpen={menuOpen} setMenuOpen={setMenuOpen} compact={scrollState.compact}>
      <FeedStatus state={state}><details id="reading-options" hidden={['sources', 'saved', 'excluded'].includes(route.view)}><summary>Reading options</summary><div className="options-content"><label className="scroll-read-control"><input id="scroll-read" type="checkbox" checked={state.markReadOnScroll} onChange={event => state.setMarkReadOnScroll(event.target.checked)}/>Mark items read as I scroll past them</label><button id="mark-read" className="secondary-button" disabled={!unread} onClick={async () => {await state.bulkRead(); document.querySelector('#reading-options').open = false; document.querySelector('#undo-read').focus({preventScroll: true});}}>Mark {unread.toLocaleString()} matching {route.mode} read</button><p className="hint">Mark every item that matches your filters and search as read, including items you have not scrolled to or opened with Show more.</p></div></details></FeedStatus>
      <button id="new-items" className="new-items" hidden={!pendingCount} onClick={() => {flushSync(() => state.revealPending()); window.scrollTo({top: 0, behavior: 'instant'}); scrolling.current?.sync(); document.querySelector('#heading').focus({preventScroll: true});}}>Show {pendingCount} new {route.mode}</button>
    </Header>
    <ReadingViewport state={state}><main id="main" tabIndex={-1}>
      <section id="page-heading" className={`page-heading${!['saved', 'sources', 'excluded'].includes(route.view) ? ' sr-only' : ''}`}><h1 id="heading" tabIndex={-1}>{heading}</h1><p id="description" hidden/></section>
      <nav id="saved-kinds" className="view-nav" aria-label="Saved item type" hidden={route.view !== 'saved'}>{['all', 'articles', 'posts'].map(kind => <button key={kind} data-kind={kind} aria-pressed={route.savedKind === kind} onClick={() => state.navigate({savedKind: kind})}>{kind === 'all' ? 'All' : kind === 'articles' ? 'Articles' : 'Posts'}</button>)}</nav>
      <div id="filter-chips" className="filter-chips" aria-label="Active filters" hidden={!filterActive}>
        {route.category && <button className="filter-chip" onClick={() => state.navigate({category: ''})}>{categoryName(route.category, state)} ×</button>}
        {route.source && <button className="filter-chip" onClick={() => state.navigate({source: ''})}>{state.feedMap.get(route.source)?.name} ×</button>}
        {route.query && <button className="filter-chip" onClick={() => state.navigate({query: ''})}>Search: {route.query} ×</button>}
        {filterActive && <button className="text-button" onClick={() => state.navigate({category: '', source: '', query: ''})}>Clear all</button>}
      </div>
      {route.query && !sourceView && <p className="hint search-scope">Searching items already loaded in this view.</p>}
      <div className="reading-utility" hidden={route.view !== 'saved'}><button id="export-saved" className="text-button download-link" hidden={route.view !== 'saved'} disabled={!savedCount} aria-label="Export all saved items as CSV" onClick={async () => download(await state.exportSaved())}>Export saved items as CSV</button></div>
      <div className="reading-bar"><span id="result-label" className="sr-only">{result}</span><button id="show-all-sources" className="text-button" hidden={route.view !== 'sources' || !route.unavailableOnly} onClick={() => state.navigate({unavailableOnly: false, category: '', source: '', query: ''})}>Show all sources</button></div>
      <div id="notice" className="notice" role="status" hidden={!state.notice}>{state.notice}</div>
      <div id="undo-bar" className="notice" hidden={!state.undoRead.length}><span id="undo-message" role="status">The reader marked {state.undoRead.length} {route.mode} as read. </span><button id="undo-read" className="text-button" onClick={async () => {await state.undo(); document.querySelector('#heading').focus({preventScroll: true});}}>Undo</button></div>
      <p id="announcement" className="sr-only" role="status" aria-live="polite">{state.announcement}</p>
      <section id="stories" ref={stories} className={sourceView ? 'source-grid' : ''} aria-label={route.view === 'saved' ? 'Saved items' : sourceView ? 'Sources' : route.mode === 'posts' ? 'Posts' : 'Articles'} aria-busy={active} aria-describedby={active ? 'loading-guidance' : undefined} onPointerDown={state.rememberReading} onKeyDown={state.rememberReading}><ListContent state={state} site={site} items={items} sources={sources}/></section>
      <button id="load-more" className="load-more" hidden={sourceView || items.length <= route.limit} onClick={() => state.navigate({limit: route.limit + 60}, {replace: true, keepScroll: true})}>Show more ↓</button>
      <footer className="reader-footer">{site.repository && <a href={site.repository}>{state.catalog?.title || site.name} on GitHub</a>}</footer>
    </main></ReadingViewport>
    <button id="back-to-top" className="secondary-button" hidden={!scrollState.top} onClick={() => {window.scrollTo({top: 0, behavior: 'instant'}); document.querySelector('.wordmark').focus({preventScroll: true}); scrolling.current?.sync();}}>↑ Back to top</button>
    <ReaderDialogs state={state} site={site}/>
  </>;
}
