import {rssFeed, atomFeed, NOW, PUBLISHED, UPDATED} from './feeds.mjs';
import {jsonFeed, postsJson} from './json-feeds.mjs';

// One fictional story expressed in each supported source format. Overrides use
// common field names so the same behavior cases exercise every adapter.
export const contractFormats = ['rss', 'atom', 'json-feed', 'posts-json'];
export const contractNow = Date.parse(NOW);
export function contractFeed(format, overrides = {}) {
  const items = (Array.isArray(overrides) ? overrides : [overrides]).map(item => ({id: 'stable-story', url: 'https://publisher.example/story?utm_source=feed#top', title: 'Community reporting', html: '<p>Local reporting.</p>', published: PUBLISHED, updated: UPDATED, author: 'Alex Reporter', ...item}));
  if (format === 'rss') return rssFeed(items.map(item => ({...item, updated: null, extraXml: `${item.updated === null ? '' : `<atom:updated>${item.updated}</atom:updated>`}<author>${item.author}</author>`})));
  if (format === 'atom') return atomFeed(items.map(item => ({...item, extraXml: `<author><name>${item.author}</name></author>`})));
  if (format === 'json-feed') return jsonFeed(items.map(item => ({id: item.id, url: item.url ?? undefined, title: item.title ?? undefined, content_html: item.html ?? undefined, content_text: item.text, date_published: item.published ?? undefined, date_modified: item.updated ?? undefined, authors: [{name: item.author}]})));
  if (format === 'posts-json') return postsJson(items.map(item => ({id: item.id, url: item.url ?? undefined, title: item.title ?? undefined, html: item.html ?? undefined, text: item.text, published: item.published ?? undefined, updated: item.updated ?? undefined, author: item.author})));
  throw new Error(`Unsupported fixture format: ${format}`);
}
