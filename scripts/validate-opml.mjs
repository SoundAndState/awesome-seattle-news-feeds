import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {XMLParser, XMLValidator} from 'fast-xml-parser';
import {loadCatalog, read, sortedFeeds} from './catalog.mjs';

export function validateOpml(text, catalog) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('OPML must not contain DTDs or entities');
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new Error(`Malformed OPML: ${valid.err.msg}`);
  if (!text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')) throw new Error('Missing UTF-8 XML declaration');
  const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, isArray: name => name === 'outline'});
  const document = parser.parse(text);
  assert.deepEqual(Object.keys(document).sort(), ['?xml', 'opml']);
  const expected = {
    head: {title: catalog.title},
    body: {outline: catalog.categories.map(category => ({
      '@_text': category.title,
      '@_title': category.title,
      outline: sortedFeeds(catalog, category.id).map(feed => ({
        '@_type': 'rss', '@_text': feed.name, '@_title': feed.name,
        '@_description': feed.description, '@_xmlUrl': feed.feed, '@_htmlUrl': feed.website,
      })),
    }))},
    '@_version': '2.0',
  };
  assert.deepEqual(document.opml, expected, 'OPML 2.0 structure, required attributes, folders, and subscriptions must match data/feeds.json exactly');
  if (/\r|[\t ]+\n/.test(text) || !text.endsWith('\n')) throw new Error('OPML must use LF, a final newline, and no trailing whitespace');
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateOpml(await read('feeds.opml'), await loadCatalog());
  console.log('OPML XML syntax, OPML 2.0 subscription structure, formatting, and JSON parity passed.');
}
