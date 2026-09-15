import {parseFeed, parseOpml} from 'feedsmith';

export const REFRESH_MS = 15 * 60 * 1000;

export function safeUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function storyKey(url, feedId, guid) {
  if (url) {
    const canonical = new URL(url);
    canonical.hash = '';
    for (const key of [...canonical.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) canonical.searchParams.delete(key);
    canonical.searchParams.sort();
    return canonical.href;
  }
  return `${feedId}:${guid}`;
}

export function normalizeFeed(text, source, now = Date.now()) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Feed contains unsupported XML declarations.');
  const {feed, format} = parseFeed(text);
  const entries = format === 'atom' ? feed.entries : feed.items;
  if (!entries?.length) throw new Error('No stories were returned.');
  const result = new Map();
  for (const item of entries.slice(0, 300)) {
    const link = format === 'atom' ? item.links?.find(link => !link.rel || link.rel === 'alternate')?.href : item.url || item.link || (item.guid?.isPermaLink !== false ? item.guid?.value : '');
    const url = safeUrl(link, source.website);
    const rawDate = item.pubDate || item.published || item.date_published || item.dc?.date || item.updated || item.date_modified;
    const parsed = Date.parse(rawDate);
    const published = Number.isFinite(parsed) && parsed <= now + 24 * 60 * 60 * 1000 ? parsed : 0;
    const title = typeof item.title === 'string' ? item.title : 'Untitled story';
    const html = item.content?.encoded || (typeof item.content === 'string' ? item.content : '') || item.content_html || item.description || item.summary || item.content_text || '';
    const guid = item.guid?.value || item.id || `${title}:${rawDate || ''}`;
    const id = storyKey(url, source.id, guid);
    result.set(id, {id, url, title: title.slice(0, 2000), html: String(html).slice(0, 100000), published, firstSeen: now, feedIds: [source.id]});
  }
  return [...result.values()];
}

export function verifyOpml(text, catalog) {
  const outlines = [];
  const walk = items => {for (const item of items || []) { if (item.xmlUrl) outlines.push(item.xmlUrl); walk(item.outlines); }};
  walk(parseOpml(text).body?.outlines);
  const urls = new Set(outlines);
  if (urls.size !== catalog.feeds.length || catalog.feeds.some(feed => !urls.has(feed.feed))) throw new Error('The published feed list is out of sync. Please try again later.');
  return catalog;
}

export function nextRefresh(failures = 0, now = Date.now()) {
  return now + Math.min(6 * 60 * 60 * 1000, REFRESH_MS * 2 ** Math.min(failures, 6));
}

export async function inBatches(items, work, concurrency = 4) {
  let index = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (index < items.length) {const item = items[index++]; await work(item);}
  }));
}
