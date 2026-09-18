import {feedMode} from './source-model.mjs';
import {itemMode, MAX_ITEM_ID_LENGTH} from './item-model.mjs';
export {feedMode, itemMode};

export function normalizeRoute(route, feedMap, categoryMap) {
  const view = ['all', 'unread', 'saved', 'sources', 'excluded'].includes(route.view) ? route.view : 'unread';
  const legacyPosts = feedMap.has(route.source) ? feedMode(feedMap.get(route.source)) === 'posts' : route.category === 'bluesky';
  const mode = route.mode === 'posts' || (!route.mode && legacyPosts) ? 'posts' : 'articles';
  const source = view !== 'saved' && feedMap.has(route.source) && feedMode(feedMap.get(route.source)) === mode ? route.source : '';
  const legacyCategory = route.category === 'bluesky' && !route.mode;
  const category = view !== 'saved' && !legacyCategory && categoryMap.has(route.category) && [...feedMap.values()].some(feed => feed.category === route.category && feedMode(feed) === mode) ? route.category : '';
  const article = String(route.article || '').slice(0, MAX_ITEM_ID_LENGTH);
  return {...route, mode, view, source, category, query: String(route.query || '').slice(0, 500),
    savedKind: ['articles', 'posts'].includes(route.savedKind) ? route.savedKind : 'all',
    limit: Math.max(60, Math.min(20000, Number(route.limit) || 60)), article,
    about: Boolean(route.about) && !article, feedList: Boolean(route.feedList) && !article && !route.about,
    filters: Boolean(route.filters) && !article && !route.about && !route.feedList && view !== 'saved',
    unavailableOnly: view === 'sources' && Boolean(route.unavailableOnly)};
}

export function matchesItem(item, route, feedMap, excluded = new Set()) {
  const mode = itemMode(item, feedMap);
  if (route.view === 'saved') return route.savedKind === 'all' || mode === route.savedKind;
  if (!route.source && item.feedIds.every(id => excluded.has(id))) return false;
  return mode === route.mode && (!route.category || item.feedIds.some(id => feedMap.get(id)?.category === route.category)) && (!route.source || item.feedIds.includes(route.source));
}
