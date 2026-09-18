import {readSourceEntries} from './source-adapters/index.mjs';
import {createSourceItem} from './item-model.mjs';

// Preserve the public parser API used by the reader and snapshot collector.
// All adapters pass through the same identity, limits, and duplicate policy.
export function normalizeFeed(text, source, now = Date.now()) {
  const result = new Map();
  for (const entry of readSourceEntries(text, source, now)) {
    const item = createSourceItem(entry, source, now);
    result.set(item.id, item);
  }
  return [...result.values()];
}

// Compatibility exports for existing parser consumers. Application code uses
// the owning modules directly so links and scheduling do not depend on parsing.
export {safeUrl, archiveUrl} from './links.mjs';
export {storyKey, MAX_ITEM_ID_LENGTH} from './item-model.mjs';
export {selectedSources} from './source-model.mjs';
export {verifyOpml} from './opml.mjs';
export {REFRESH_MS, nextRefresh, inBatches} from './refresh-policy.mjs';
