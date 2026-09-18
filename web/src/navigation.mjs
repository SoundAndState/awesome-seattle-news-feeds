const defaults = {mode: '', view: 'all', savedKind: 'all', category: '', source: '', query: '', unavailableOnly: false, limit: 60, article: '', about: false, feedList: false, filters: false};

// Hashes keep searches and article IDs out of requests to the site host.
export function readerNavigation({normalize, apply, preferredView = () => 'unread'}) {
  let current, entryKey, searching = false;
  const positions = new Map();
  let contexts = {};
  const route = value => normalize({...defaults, ...value});
  const fromUrl = () => {
    const params = new URLSearchParams(location.hash.slice(1));
    return route({mode: params.get('mode') || '', view: params.get('view') || preferredView(), savedKind: params.get('kind') || 'all', category: params.get('section') || '', source: params.get('source') || '', query: params.get('q') || '', unavailableOnly: params.has('unavailable'), article: params.get('article') || '', about: params.has('about'), feedList: params.has('feed-list'), filters: params.has('filters')});
  };
  const url = state => {
    const params = new URLSearchParams();
    if (state.mode === 'posts') params.set('mode', 'posts');
    params.set('view', state.view);
    if (state.view === 'saved' && state.savedKind !== 'all') params.set('kind', state.savedKind);
    if (state.category) params.set('section', state.category);
    if (state.source) params.set('source', state.source);
    if (state.query) params.set('q', state.query);
    if (state.unavailableOnly) params.set('unavailable', '1');
    if (state.article) params.set('article', state.article);
    if (state.about) params.set('about', '1');
    if (state.feedList) params.set('feed-list', '1');
    if (state.filters) params.set('filters', '1');
    return `${location.pathname}${location.search}${params.size ? `#${params}` : ''}`;
  };
  function remember() {
    if (!current) return;
    positions.set(entryKey, window.scrollY);
    if (['all', 'unread'].includes(current.view) && !current.article && !current.about && !current.feedList && !current.filters) contexts[current.mode] = {route: current, y: window.scrollY};
    history.replaceState({...history.state, reader: true, key: entryKey, route: current, y: window.scrollY, contexts}, '', url(current));
  }
  function restore(state) {
    current = route(state?.reader ? state.route : fromUrl());
    entryKey = state?.key || crypto.randomUUID();
    searching = false;
    contexts = state?.contexts || contexts;
    history.replaceState({...state, reader: true, key: entryKey, route: current, contexts}, '', url(current));
    apply(current, Math.max(0, positions.get(entryKey) ?? (Number(state?.y) || 0)));
  }
  function go(changes, {replace = false, keepScroll = false, search = false, scroll} = {}) {
    const next = route({...current, article: '', about: false, feedList: false, filters: false, limit: 60, ...changes});
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    remember();
    const overlay = Boolean(next.article || next.about || next.feedList || next.filters) && !(current.article || current.about || current.feedList || current.filters);
    const y = scroll ?? (keepScroll || overlay ? window.scrollY : 0);
    const state = {reader: true, key: crypto.randomUUID(), route: next, y, overlay, contexts};
    history[replace || (search && searching) ? 'replaceState' : 'pushState'](state, '', url(next));
    searching = search;
    entryKey = state.key;
    current = next;
    apply(current, y);
  }
  const previousScrollRestoration = history.scrollRestoration;
  history.scrollRestoration = 'manual';
  const onPopState = event => restore(event.state);
  const onScroll = () => positions.set(entryKey, window.scrollY);
  window.addEventListener('popstate', onPopState);
  // Save position before reloads, external links, or the browser's Back button.
  // In-memory positions avoid replaceState on every scroll event (browser rate limits).
  window.addEventListener('scroll', onScroll, {passive: true});
  window.addEventListener('pagehide', remember);
  return {
    get current() {return current;},
    go,
    switchMode(mode) {
      remember();
      const previous = contexts[mode];
      go({...defaults, ...previous?.route, mode, view: preferredView(), unavailableOnly: false}, {scroll: previous?.y || 0});
    },
    endSearch() {searching = false;},
    destroy() {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', remember);
      history.scrollRestoration = previousScrollRestoration;
    },
    close() {
      if (history.state?.overlay) history.back();
      else go({article: '', about: false, feedList: false, filters: false, limit: current.limit}, {replace: true, keepScroll: true});
    },
    start() {
      const state = history.state;
      current = fromUrl();
      // Only reuse a stored entry when its URL still matches (e.g. a reload).
      const previous = state?.reader && url(route(state.route)) === url(current) ? state : {reader: true, key: crypto.randomUUID(), route: current, y: 0};
      history.replaceState(previous, '', url(current));
      restore(previous);
    },
  };
}
