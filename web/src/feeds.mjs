import {parseFeed, parseOpml} from 'feedsmith';
import {feedDates} from './dates.mjs';
import {feedMode} from './reader-state.mjs';

export const REFRESH_MS = 15 * 60 * 1000;
export const MAX_ITEM_ID_LENGTH = 4096;

export function selectedSources(feeds, {category = '', source = '', includeSocial = false} = {}) {
  return feeds.filter(feed => (!category || feed.category === category) && (!source || feed.id === source) && (includeSocial || category || source || feedMode(feed) !== 'posts'));
}

const escapeHtml = text => text.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

function postHeadline(text) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const preview = [...normalized].slice(0, 160).join('');
  return (preview.length < normalized.length ? preview.replace(/\s+\S*$/, '') : preview) || 'Untitled post';
}

function jsonItems(text, format) {
  let data;
  try {data = JSON.parse(text);} catch {throw new Error('The source did not return valid JSON.');}
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The JSON source must be an object.');
  if (format === 'posts-json') {
    if (data.version !== 1 || !Array.isArray(data.posts)) throw new Error('The posts source requires version 1 and a posts list.');
    const items = data.posts.slice(0, 300).map(post => {
      if (!post || typeof post !== 'object' || Array.isArray(post)) throw new Error('The posts source contains an invalid post.');
      if (post.author !== undefined && typeof post.author !== 'string') throw new Error('A post author must be text.');
      return {id: post.id, url: post.url, title: post.title, content_text: post.text, content_html: post.html, date_published: post.published, date_modified: post.updated, authors: post.author ? [{name: post.author}] : []};
    });
    return validateJsonItems(items);
  }
  if (!['https://jsonfeed.org/version/1', 'https://jsonfeed.org/version/1.1'].includes(data.version) || !Array.isArray(data.items) || typeof data.title !== 'string') throw new Error('The source must use JSON Feed version 1 or 1.1.');
  return validateJsonItems(data.items.slice(0, 300).map(item => ({...item, authors: item.authors ?? (item.author ? [item.author] : data.authors ?? (data.author ? [data.author] : []))})));
}

function validateJsonItems(items) {
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !item.id || item.id.length > MAX_ITEM_ID_LENGTH) throw new Error('Each JSON item needs a stable text ID.');
    for (const key of ['url', 'title', 'content_html', 'content_text', 'summary', 'date_published', 'date_modified']) {
      if (item[key] !== undefined && typeof item[key] !== 'string') throw new Error(`A JSON item's ${key} must be text.`);
    }
    if (typeof item.content_html !== 'string' && typeof item.content_text !== 'string') throw new Error('Each JSON item needs content_html or content_text.');
    if (!Array.isArray(item.authors) || item.authors.some(author => !author || typeof author !== 'object' || Array.isArray(author) || (author.name !== undefined && typeof author.name !== 'string'))) throw new Error('JSON item authors must be objects with optional text names.');
  }
  return items;
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
  const requested = (source.format || 'auto').toLowerCase();
  const json = ['json-feed', 'posts-json'].includes(requested) || /^[\s\uFEFF]*[\[{]/.test(text);
  if (!json && /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Feed contains unsupported XML declarations.');
  const {feed, format} = json ? {feed: {items: jsonItems(text, requested)}, format: 'json'} : parseFeed(text);
  const entries = format === 'atom' ? feed.entries : feed.items;
  if (!entries?.length) {
    if (json && Array.isArray(entries)) return [];
    throw new Error('The feed contains no articles or posts.');
  }
  const result = new Map();
  for (const item of entries.slice(0, 300)) {
    const link = format === 'atom' ? item.links?.find(link => !link.rel || link.rel === 'alternate')?.href : item.url || item.link || (item.guid?.isPermaLink !== false ? item.guid?.value : '');
    const url = safeUrl(link, source.website);
    const dates = feedDates(item, now);
    // Retain the identity fallback used by older libraries for linkless entries.
    const identityDate = item.pubDate || item.published || item.date_published || item.dc?.date || item.updated || item.date_modified;
    const kind = feedMode(source);
    // Bluesky RSS descriptions are literal post text, including angle brackets.
    // Other post adapters declare their text and HTML separately.
    const social = kind === 'posts' && source.category === 'bluesky' && format !== 'json';
    const postText = social ? (typeof item.description === 'string' ? item.description : '') : item.content_text || '';
    const title = social ? escapeHtml(postHeadline(postText)) : typeof item.title === 'string' && item.title.trim() ? (format === 'json' ? escapeHtml(item.title) : item.title) : kind === 'posts' ? escapeHtml(postHeadline(postText)) : 'Untitled story';
    const html = social ? `<p>${escapeHtml(postText).replace(/\r?\n/g, '<br>')}</p>` : item.content?.encoded || (typeof item.content === 'string' ? item.content : '') || item.content_html || (item.content_text ? `<p>${escapeHtml(item.content_text).replace(/\r?\n/g, '<br>')}</p>` : '') || item.description || item.summary || '';
    const guid = item.guid?.value || item.id || `${title}:${identityDate || ''}`;
    const id = social && /^at:\/\/did:[^/]+\/app\.bsky\.feed\.post\//.test(guid) ? guid : storyKey(url, source.id, guid);
    // The final identity includes the source prefix for linkless entries or a
    // canonical URL. Every accepted item must survive a reading-backup restore.
    if (id.length > MAX_ITEM_ID_LENGTH) throw new Error('The item identity exceeds the 4,096-character limit.');
    const people = item.dc?.creators || item.dcterms?.creators || item.authors || item.atom?.authors || (format === 'atom' ? item.source?.authors || feed.authors : []) || [];
    const author = [...new Set(people.map(person => typeof person === 'string' ? person : person.name || '').filter(Boolean))].join(', ').slice(0, 500);
    result.set(id, {id, url, kind, title: title.slice(0, 2000), author, html: String(html).slice(0, 100000), ...dates, firstSeen: now, feedIds: [source.id]});
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
