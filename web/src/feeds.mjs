import {parseFeed, parseOpml} from 'feedsmith';
import {feedDates} from './dates.mjs';

export const REFRESH_MS = 15 * 60 * 1000;

export function selectedSources(feeds, {category = '', source = '', includeSocial = false} = {}) {
  return feeds.filter(feed => (!category || feed.category === category) && (!source || feed.id === source) && (includeSocial || category || source || feed.category !== 'bluesky'));
}

const escapeHtml = text => text.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

function postHeadline(text) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const preview = [...normalized].slice(0, 160).join('');
  return (preview.length < normalized.length ? preview.replace(/\s+\S*$/, '') : preview) || 'Bluesky post';
}

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

export function archiveUrl(value) {
  const safe = safeUrl(value);
  if (!safe) return '';
  const article = new URL(safe);
  for (const key of [...article.searchParams.keys()]) if (/^utm_/i.test(key)) article.searchParams.delete(key);
  article.hash = '';
  return `https://ghostarchive.org/search?go=Go&term=${encodeURIComponent(article.href)}`;
}

export function normalizeFeed(text, source, now = Date.now()) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Feed contains unsupported XML declarations.');
  const {feed, format} = parseFeed(text);
  const entries = format === 'atom' ? feed.entries : feed.items;
  if (!entries?.length) throw new Error('The feed contains no articles or posts.');
  const result = new Map();
  for (const item of entries.slice(0, 300)) {
    const link = format === 'atom' ? item.links?.find(link => !link.rel || link.rel === 'alternate')?.href : item.url || item.link || (item.guid?.isPermaLink !== false ? item.guid?.value : '');
    const url = safeUrl(link, source.website);
    const dates = feedDates(item, now);
    // Retain the identity fallback used by older libraries for linkless entries.
    const identityDate = item.pubDate || item.published || item.date_published || item.dc?.date || item.updated || item.date_modified;
    const social = source.category === 'bluesky';
    const postText = typeof item.description === 'string' ? item.description : '';
    const title = social ? escapeHtml(postHeadline(postText)) : typeof item.title === 'string' ? item.title : 'Untitled story';
    const html = social ? `<p>${escapeHtml(postText).replace(/\r?\n/g, '<br>')}</p>` : item.content?.encoded || (typeof item.content === 'string' ? item.content : '') || item.content_html || item.description || item.summary || item.content_text || '';
    const guid = item.guid?.value || item.id || `${title}:${identityDate || ''}`;
    const id = social && /^at:\/\/did:[^/]+\/app\.bsky\.feed\.post\//.test(guid) ? guid : storyKey(url, source.id, guid);
    result.set(id, {id, url, title: title.slice(0, 2000), html: String(html).slice(0, 100000), ...dates, firstSeen: now, feedIds: [source.id]});
  }
  return [...result.values()];
}

export function verifyOpml(text, catalog) {
  const outlines = [];
  const walk = items => {for (const item of items || []) { if (item.xmlUrl) outlines.push(item.xmlUrl); walk(item.outlines); }};
  walk(parseOpml(text).body?.outlines);
  const urls = new Set(outlines);
  if (urls.size !== catalog.feeds.length || catalog.feeds.some(feed => !urls.has(feed.feed))) throw new Error('The reader found two versions of the feed list that do not match. Reload the page in a few minutes to try again.');
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
