export const SOURCE_FORMATS = Object.freeze(['auto', 'rss', 'atom', 'json-feed', 'posts-json']);

export const feedMode = feed => ['articles', 'posts'].includes(feed.kind) ? feed.kind : feed.category === 'bluesky' ? 'posts' : 'articles';

export function selectedSources(feeds, {category = '', source = '', includeSocial = false} = {}) {
  return feeds.filter(feed => (!category || feed.category === category) && (!source || feed.id === source) && (includeSocial || category || source || feedMode(feed) !== 'posts'));
}
