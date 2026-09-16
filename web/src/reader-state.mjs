export const feedMode = feed => feed.category === 'bluesky' ? 'posts' : 'articles';

export function itemMode(item, feedMap) {
  // Stable IDs also identify saved posts whose account has left the catalog.
  return item.feedIds.some(id => feedMap.get(id)?.category === 'bluesky' || id.startsWith('bluesky-')) || item.id.startsWith('at://') ? 'posts' : 'articles';
}

export function normalizeRoute(route, feedMap, categoryMap) {
  const view = ['all', 'unread', 'saved', 'sources'].includes(route.view) ? route.view : 'all';
  const legacyPosts = route.category === 'bluesky' || feedMap.get(route.source)?.category === 'bluesky';
  const mode = route.mode === 'posts' || (!route.mode && legacyPosts) ? 'posts' : 'articles';
  const source = view !== 'saved' && feedMap.has(route.source) && feedMode(feedMap.get(route.source)) === mode ? route.source : '';
  const category = view !== 'saved' && mode === 'articles' && route.category !== 'bluesky' && categoryMap.has(route.category) ? route.category : '';
  const article = String(route.article || '').slice(0, 4096);
  return {...route, mode, view, source, category, query: String(route.query || '').slice(0, 500),
    savedKind: ['articles', 'posts'].includes(route.savedKind) ? route.savedKind : 'all',
    limit: Math.max(60, Math.min(20000, Number(route.limit) || 60)), article,
    about: Boolean(route.about) && !article, feedList: Boolean(route.feedList) && !article && !route.about,
    filters: Boolean(route.filters) && !article && !route.about && !route.feedList && view !== 'saved',
    unavailableOnly: view === 'sources' && Boolean(route.unavailableOnly)};
}

export function matchesItem(item, route, feedMap) {
  const mode = itemMode(item, feedMap);
  if (route.view === 'saved') return route.savedKind === 'all' || mode === route.savedKind;
  return mode === route.mode && (!route.category || item.feedIds.some(id => feedMap.get(id)?.category === route.category)) && (!route.source || item.feedIds.includes(route.source));
}
