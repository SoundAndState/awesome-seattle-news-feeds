const defaults = {view: 'all', category: '', source: '', query: '', unavailableOnly: false, limit: 60, article: '', about: false};

// Hashes keep searches and article IDs out of requests to the site host.
export function readerNavigation({normalize, apply}) {
  let current, entryKey, searching = false;
  const positions = new Map();
  const route = value => normalize({...defaults, ...value});
  const fromUrl = () => {
    const params = new URLSearchParams(location.hash.slice(1));
    return route({view: params.get('view') || 'all', category: params.get('section') || '', source: params.get('source') || '', query: params.get('q') || '', unavailableOnly: params.has('unavailable'), article: params.get('article') || '', about: params.has('about')});
  };
  const url = state => {
    const params = new URLSearchParams();
    if (state.view !== 'all') params.set('view', state.view);
    if (state.category) params.set('section', state.category);
    if (state.source) params.set('source', state.source);
    if (state.query) params.set('q', state.query);
    if (state.unavailableOnly) params.set('unavailable', '1');
    if (state.article) params.set('article', state.article);
    if (state.about) params.set('about', '1');
    return `${location.pathname}${location.search}${params.size ? `#${params}` : ''}`;
  };
  function remember() {
    if (!current) return;
    positions.set(entryKey, window.scrollY);
    history.replaceState({...history.state, reader: true, key: entryKey, route: current, y: window.scrollY}, '', url(current));
  }
  function restore(state) {
    current = route(state?.reader ? state.route : fromUrl());
    entryKey = state?.key || crypto.randomUUID();
    searching = false;
    apply(current, Math.max(0, positions.get(entryKey) ?? (Number(state?.y) || 0)));
  }
  function go(changes, {replace = false, keepScroll = false, search = false} = {}) {
    const next = route({...current, article: '', about: false, limit: 60, ...changes});
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    remember();
    const overlay = Boolean(next.article || next.about) && !(current.article || current.about);
    const y = keepScroll || overlay ? window.scrollY : 0;
    const state = {reader: true, key: crypto.randomUUID(), route: next, y, overlay};
    history[replace || (search && searching) ? 'replaceState' : 'pushState'](state, '', url(next));
    searching = search;
    entryKey = state.key;
    current = next;
    apply(current, y);
  }
  history.scrollRestoration = 'manual';
  window.addEventListener('popstate', event => restore(event.state));
  // Save position before reloads, external links, or the browser's Back button.
  // In-memory positions avoid replaceState on every scroll event (browser rate limits).
  window.addEventListener('scroll', () => positions.set(entryKey, window.scrollY), {passive: true});
  window.addEventListener('pagehide', remember);
  return {
    get current() {return current;},
    go,
    endSearch() {searching = false;},
    close() {
      if (history.state?.overlay) history.back();
      else go({article: '', about: false, limit: current.limit}, {replace: true, keepScroll: true});
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
