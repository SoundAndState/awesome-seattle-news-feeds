import {messages} from './localization.mjs';
import {parseOpml} from 'feedsmith';

export function verifyOpml(text, catalog) {
  const outlines = [];
  const walk = items => {for (const item of items || []) {if (item.xmlUrl) outlines.push(item.xmlUrl); walk(item.outlines);}};
  walk(parseOpml(text).body?.outlines);
  const urls = new Set(outlines);
  if (urls.size !== catalog.feeds.length || catalog.feeds.some(feed => !urls.has(feed.feed))) throw new Error(messages.catalog.mismatchedOpml);
  return catalog;
}
