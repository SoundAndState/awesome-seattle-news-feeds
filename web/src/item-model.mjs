import {safeUrl} from './links.mjs';
import {validTimestamp} from './dates.mjs';
import {feedMode} from './source-model.mjs';

export const ITEM_LIMITS = Object.freeze({id: 4096, title: 2000, html: 100000, author: 500, sourceName: 200, excerpt: 260, feedId: 120, feedIds: 1000, perFeed: 300});
export const MAX_ITEM_ID_LENGTH = ITEM_LIMITS.id;

/**
 * @typedef {object} ReaderItem
 * @property {string} id Stable identity; never regenerate when restoring a backup.
 * @property {string} url Safe HTTP(S) destination, or an empty string.
 * @property {'articles'|'posts'} [kind] Legacy stored items can omit this field.
 * @property {string} title Plain text after prepareItem's text boundary.
 * @property {string} html Untrusted publisher HTML; sanitize before DOM insertion.
 * @property {string} author Publisher-provided byline.
 * @property {string} sourceName Fallback attribution if the source leaves the catalog.
 * @property {string} excerpt Plain text derived from html.
 * @property {string[]} feedIds Ordered provenance; the primary source comes first.
 * @property {number} published Publication time in milliseconds, or zero if absent.
 * @property {boolean} publishedDateOnly Whether publication supplies only a date.
 * @property {number} updated Update time in milliseconds, or zero if absent.
 * @property {boolean} updatedDateOnly Whether update supplies only a date.
 * @property {number} firstSeen Local arrival time, independent of publisher dates.
 */

/**
 * @typedef {object} SourceEntry
 * @property {string} [url] Original publisher link, before safety checks.
 * @property {string} title Publisher markup or escaped literal text.
 * @property {string} html Untrusted content, before length limits.
 * @property {string} author Combined publisher-provided byline.
 * @property {string} [guid] Stable publisher identifier for linkless entries.
 * @property {string} [nativeId] Optional platform identity independent of URL.
 * @property {string} [identityDate] Original date used by legacy identity fallback.
 * @property {number} published
 * @property {boolean} publishedDateOnly
 * @property {number} updated
 * @property {boolean} updatedDateOnly
 */

export function itemMode(item, feedMap) {
  if (['articles', 'posts'].includes(item.kind)) return item.kind;
  // Preserve old libraries and saved posts whose source has left the catalog.
  return item.feedIds.some(id => (feedMap.has(id) && feedMode(feedMap.get(id)) === 'posts') || id.startsWith('bluesky-')) || item.id.startsWith('at://') ? 'posts' : 'articles';
}

export const validItemId = id => typeof id === 'string' && id.length > 0 && id.length <= ITEM_LIMITS.id;
const invalidItem = (code, message) => Object.assign(new Error(message), {code});

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

// Adapters supply format-independent entries. Identity uses the full original
// title/date fallback before display truncation, preserving existing libraries.
/** @param {SourceEntry} entry */
export function createSourceItem(entry, source, now) {
  const url = safeUrl(entry.url, source.website);
  const id = entry.nativeId || storyKey(url, source.id, entry.guid || `${entry.title}:${entry.identityDate || ''}`);
  if (!validItemId(id)) throw new Error('The item identity exceeds the 4,096-character limit.');
  const item = {
    id, url, kind: feedMode(source), title: entry.title.slice(0, ITEM_LIMITS.title),
    html: entry.html.slice(0, ITEM_LIMITS.html), author: entry.author.slice(0, ITEM_LIMITS.author),
    published: entry.published, publishedDateOnly: entry.publishedDateOnly,
    updated: entry.updated, updatedDateOnly: entry.updatedDateOnly,
    firstSeen: now, feedIds: [source.id],
  };
  validateItem(item);
  return item;
}

// Feed items and backups share structural limits. Legacy records may lack kind,
// author, updated, or date-only flags; hydration supplies those defaults without
// changing their identity or inventing a publication date.
export function validateItem(item, {requireSourceName = false} = {}) {
  if (!item || !validItemId(item.id) || !Array.isArray(item.feedIds) || item.feedIds.length > ITEM_LIMITS.feedIds || item.feedIds.some(id => typeof id !== 'string' || id.length > ITEM_LIMITS.feedId) || typeof item.title !== 'string' || typeof item.html !== 'string' || item.html.length > ITEM_LIMITS.html || (requireSourceName && typeof item.sourceName !== 'string') || !Number.isFinite(item.published) || !Number.isFinite(item.firstSeen)) {
    throw invalidItem('invalid-item', 'The item does not match the reader item contract.');
  }
  if (item.updated !== undefined && item.updated !== 0 && !validTimestamp(item.updated)) throw invalidItem('invalid-updated', 'The item has an invalid update date.');
  if (item.kind !== undefined && !['articles', 'posts'].includes(item.kind)) throw invalidItem('invalid-kind', 'The item has an invalid content kind.');
  return item;
}

// Plain-text conversion is injected: parsers and backup validation stay usable
// outside a DOM. html remains untrusted and is sanitized by articleContent.
export function prepareItem(item, cleanText) {
  validateItem(item);
  return {
    id: item.id, url: safeUrl(item.url), title: cleanText(item.title).slice(0, ITEM_LIMITS.title),
    html: item.html, excerpt: cleanText(item.html).slice(0, ITEM_LIMITS.excerpt),
    sourceName: cleanText(item.sourceName || '').slice(0, ITEM_LIMITS.sourceName),
    author: typeof item.author === 'string' ? cleanText(item.author).slice(0, ITEM_LIMITS.author) : '',
    feedIds: [...item.feedIds], published: item.published, publishedDateOnly: item.publishedDateOnly === true,
    updated: item.updated || 0, updatedDateOnly: item.updatedDateOnly === true, firstSeen: item.firstSeen,
    ...(item.kind ? {kind: item.kind} : {}),
  };
}

export function mergeSourceItem(existing, incoming, source, feedMap, cleanText) {
  validateItem(incoming);
  if (existing && existing.id !== incoming.id) throw new Error('Only items with the same identity can be merged.');
  const mixedKinds = existing && itemMode(existing, feedMap) !== itemMode(incoming, feedMap);
  const keepArticle = mixedKinds && itemMode(existing, feedMap) === 'articles';
  const feedIds = [...new Set([...(mixedKinds && !keepArticle ? [source.id] : []), ...(existing?.feedIds || []), ...incoming.feedIds, source.id])];
  // Reporting wins over a post linking to it, in either arrival order. Keep
  // read/save marks outside item bodies, keyed by this unchanged identity.
  const merged = keepArticle ? {...existing, kind: 'articles', feedIds, sourceName: existing.sourceName || feedMap.get(existing.feedIds[0])?.name || ''} : {
    ...prepareItem({...incoming, sourceName: mixedKinds ? source.name : existing?.sourceName || source.name}, cleanText),
    firstSeen: existing?.firstSeen || incoming.firstSeen, feedIds,
  };
  validateItem(merged, {requireSourceName: true});
  return merged;
}
