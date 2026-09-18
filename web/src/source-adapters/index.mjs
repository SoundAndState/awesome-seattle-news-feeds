import {readXml} from './xml.mjs';
import {readJsonFeed, readPostsJson} from './json.mjs';

export const adapters = Object.freeze({rss: readXml, atom: readXml, 'json-feed': readJsonFeed, 'posts-json': readPostsJson});

// Keep XML's historical format detection, including catalogs that label a feed
// RSS before its publisher switches to Atom or JSON Feed. Posts JSON is explicit.
export function readSourceEntries(text, source, now) {
  const requested = (source.format || 'auto').toLowerCase();
  if (requested !== 'auto' && !Object.hasOwn(adapters, requested)) throw new Error(`The reader does not support the feed format: ${requested}.`);
  const detected = /^[\s\uFEFF]*[\[{]/.test(text) ? 'json-feed' : 'rss';
  const format = ['auto', 'rss', 'atom'].includes(requested) ? detected : requested;
  return adapters[format](text, source, now);
}
