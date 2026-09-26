import {messages} from './localization.mjs';
import {validItemId, validateItem, prepareItem} from './item-model.mjs';

export const BACKUP_VERSION = 1;
const LEGACY_COLLECTION = 'sound-and-state';

export function readingBackup({states, articles}, site, now = new Date()) {
  return {
    format: 'sound-and-state', version: BACKUP_VERSION, collection: site.storageNamespace,
    exportedAt: now.toISOString(), state: [...states.values()].map(({id, read, saved}) => ({id, read, saved})),
    savedArticles: [...articles.values()].filter(item => states.get(item.id)?.saved),
  };
}

// Validate the entire file before applying any part of it to the library.
export function restoreReadingBackup(data, {states, articles}, normalizeText, site = {storageNamespace: LEGACY_COLLECTION}) {
  if (!data || data.format !== 'sound-and-state' || data.version !== BACKUP_VERSION || !Array.isArray(data.state) || !Array.isArray(data.savedArticles) || data.state.length > 100000 || data.savedArticles.length > 5000) {
    throw new Error(messages.backup.invalidFormat);
  }
  if ((data.collection === undefined ? LEGACY_COLLECTION : data.collection) !== site.storageNamespace) {
    throw new Error(messages.backup.wrongCollection);
  }
  const mergedStates = new Map();
  for (const item of data.state) {
    if (!item || !validItemId(item.id) || (item.read !== undefined && typeof item.read !== 'boolean') || (item.saved !== undefined && typeof item.saved !== 'boolean')) {
      throw new Error(messages.backup.invalidMarks);
    }
    const previous = mergedStates.get(item.id) || states.get(item.id);
    mergedStates.set(item.id, {id: item.id, read: Boolean(item.read || previous?.read), saved: Boolean(item.saved || previous?.saved)});
  }
  const savedIds = new Set([...mergedStates.values()].filter(item => item.saved).map(item => item.id));
  const restored = new Map();
  for (const item of data.savedArticles) {
    try {
      validateItem(item, {requireSourceName: true});
      if (!savedIds.has(item.id)) throw new Error('The item has no saved mark.');
    } catch (error) {
      if (error.code === 'invalid-updated') throw new Error(messages.backup.invalidDate);
      if (error.code === 'invalid-kind') throw new Error(messages.backup.invalidKind);
      throw new Error(messages.backup.invalidItem);
    }
    // Existing content wins both in memory and on disk. Restoring an older file
    // must not silently replace a current item after the next reload.
    if (articles.has(item.id)) continue;
    restored.set(item.id, prepareItem(item, normalizeText));
  }
  return {states: [...mergedStates.values()], articles: [...restored.values()]};
}
