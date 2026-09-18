import {parseOpml} from 'feedsmith';

export function verifyOpml(text, catalog) {
  const outlines = [];
  const walk = items => {for (const item of items || []) {if (item.xmlUrl) outlines.push(item.xmlUrl); walk(item.outlines);}};
  walk(parseOpml(text).body?.outlines);
  const urls = new Set(outlines);
  if (urls.size !== catalog.feeds.length || catalog.feeds.some(feed => !urls.has(feed.feed))) throw new Error('The reader found two versions of the feed list that do not match. Reload the page in a few minutes to try again.');
  return catalog;
}
