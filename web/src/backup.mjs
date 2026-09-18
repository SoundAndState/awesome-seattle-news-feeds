import {safeUrl, MAX_ITEM_ID_LENGTH} from './feeds.mjs';
import {validTimestamp} from './dates.mjs';

export function readingBackup({states, articles}, site, now = new Date()) {
  return {
    format: 'sound-and-state', version: 1, collection: site.storageNamespace,
    exportedAt: now.toISOString(), state: [...states.values()],
    savedArticles: [...articles.values()].filter(item => states.get(item.id)?.saved),
  };
}

// Validate the entire file before applying any part of it to the library.
export function restoreReadingBackup(data, {states, articles}, normalizeText) {
  if (!data || data.format !== 'sound-and-state' || data.version !== 1 || !Array.isArray(data.state) || !Array.isArray(data.savedArticles) || data.state.length > 100000 || data.savedArticles.length > 5000) {
    throw new Error('The reader cannot restore this file. Choose a JSON backup from Export reading backup.');
  }
  const mergedStates = new Map();
  for (const item of data.state) {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > MAX_ITEM_ID_LENGTH || (item.read !== undefined && typeof item.read !== 'boolean') || (item.saved !== undefined && typeof item.saved !== 'boolean')) {
      throw new Error('The reader cannot read which items this backup marks as read or saved. Choose another backup.');
    }
    const previous = mergedStates.get(item.id) || states.get(item.id);
    mergedStates.set(item.id, {id: item.id, read: Boolean(item.read || previous?.read), saved: Boolean(item.saved || previous?.saved)});
  }
  const savedIds = new Set([...mergedStates.values()].filter(item => item.saved).map(item => item.id));
  const restored = new Map();
  for (const item of data.savedArticles) {
    if (!item || !savedIds.has(item.id) || !Array.isArray(item.feedIds) || item.feedIds.length > 1000 || item.feedIds.some(id => typeof id !== 'string' || id.length > 120) || typeof item.title !== 'string' || typeof item.html !== 'string' || item.html.length > 100000 || typeof item.sourceName !== 'string' || !Number.isFinite(item.published) || !Number.isFinite(item.firstSeen)) {
      throw new Error('The reader cannot read a saved item in this backup. Choose another backup.');
    }
    if (item.updated !== undefined && item.updated !== 0 && !validTimestamp(item.updated)) throw new Error('The reader cannot read an item’s update date in this backup. Choose another backup.');
    if (item.kind !== undefined && !['articles', 'posts'].includes(item.kind)) throw new Error('The reader cannot read an item’s type in this backup. Choose another backup.');
    // Existing content wins both in memory and on disk. Restoring an older file
    // must not silently replace a current item after the next reload.
    if (articles.has(item.id)) continue;
    restored.set(item.id, {
      id: item.id, url: safeUrl(item.url), title: normalizeText(item.title).slice(0, 2000),
      html: item.html, excerpt: normalizeText(item.html).slice(0, 260),
      sourceName: normalizeText(item.sourceName).slice(0, 200),
      author: typeof item.author === 'string' ? normalizeText(item.author).slice(0, 500) : '',
      feedIds: [...item.feedIds], published: item.published,
      publishedDateOnly: item.publishedDateOnly === true, updated: item.updated || 0,
      updatedDateOnly: item.updatedDateOnly === true, firstSeen: item.firstSeen,
      ...(item.kind ? {kind: item.kind} : {}),
    });
  }
  return {states: [...mergedStates.values()], articles: [...restored.values()]};
}
