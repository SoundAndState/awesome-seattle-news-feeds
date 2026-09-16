import assert from 'node:assert/strict';
import test from 'node:test';
import {XMLParser} from 'fast-xml-parser';
import {loadCatalog, validateCatalog} from '../scripts/catalog.mjs';
import {renderOpml, renderReadme} from '../scripts/render.mjs';
import {validateOpml} from '../scripts/validate-opml.mjs';
import {makeCatalog} from './fixtures/catalog.mjs';

// Catalog validity is an integration boundary: check what contributors publish.
test('the published catalog validates and produces a complete subscription list', async () => {
  const catalog = await loadCatalog();
  await validateCatalog(catalog);
  assert.equal(validateOpml(renderOpml(catalog), catalog), true);
});

test('fixture catalogs validate and give each test independent sources and aliases', async () => {
  const catalog = makeCatalog();
  await validateCatalog(catalog);
  catalog.feeds[1].aliases.push('https://publisher.example/another/rss');
  catalog.categories[0].title = 'Changed';
  assert.equal(makeCatalog().feeds[1].aliases.length, 1);
  assert.notEqual(makeCatalog().categories[0].title, 'Changed');
  await validateCatalog(makeCatalog({regionalCount: 62}));
  await validateCatalog(makeCatalog({feeds: [catalog.feeds[0]]}));
});

test('rejects an HTTP/www/trailing-slash duplicate of an active feed', async () => {
  const catalog = makeCatalog();
  const feed = catalog.feeds[0];
  const alias = new URL(feed.feed);
  alias.protocol = 'http:';
  alias.hostname = `www.${alias.hostname.replace(/^www\./, '')}`;
  alias.pathname += '/';
  catalog.feeds[1].aliases.push(alias.href);
  await assert.rejects(validateCatalog(catalog), /Duplicate feed URL/);
});

test('rejects collision with an obsolete alias, preserving category-specific feeds', async () => {
  const catalog = makeCatalog();
  const alias = catalog.feeds.find(feed => feed.aliases.length).aliases[0];
  catalog.feeds[0].aliases.push(alias);
  await assert.rejects(validateCatalog(catalog), /Duplicate feed URL/);
});

test('rejects unknown categories, malformed URLs, and invalid check dates', async () => {
  for (const mutate of [
    catalog => {catalog.feeds[0].category = 'missing';},
    catalog => {catalog.feeds[0].feed = 'https://bad url';},
    catalog => {catalog.feeds[0].checkedOn = 'not-a-date';},
  ]) {
    const catalog = makeCatalog();
    mutate(catalog);
    await assert.rejects(validateCatalog(catalog));
  }
});

test('escapes XML attributes and Markdown labels without losing Unicode or query strings', async () => {
  const catalog = makeCatalog();
  const feed = catalog.feeds[0];
  feed.name = 'Café & "News" <Local> [Seattle]';
  feed.description = 'Reporting on parks & "public" spaces.';
  feed.feed = 'https://example.com/rss?a=1&b=2';
  const opml = renderOpml(catalog);
  assert.ok(opml.includes('Café &amp; &quot;News&quot; &lt;Local&gt; [Seattle]'));
  assert.ok(opml.includes('?a=1&amp;b=2'));
  assert.ok(renderReadme(catalog).includes('\\[Seattle\\]'));
  assert.equal(validateOpml(opml, catalog), true);
});

test('rejects malformed XML, missing subscriptions, wrong URLs, folders, and required attributes', async () => {
  const catalog = makeCatalog();
  const original = renderOpml(catalog);
  const mutations = [
    original.replace('</body>', ''),
    original.replace(/      <outline[^\n]+\n/, ''),
    original.replace(/xmlUrl="[^"]+"/, 'xmlUrl="https://example.com/wrong"'),
    original.replace(/type="rss"/, ''),
    original.replace(/<outline text="[^"]+"/, '<outline text="Wrong folder"'),
    original.replace('version="2.0"', 'version="1.0"'),
    original.replace('  <body>', '<!DOCTYPE opml>\n  <body>'),
    original.replace('  <body>', '  <body>  '),
  ];
  for (const mutation of mutations) assert.throws(() => validateOpml(mutation, catalog));
});

test('generation is deterministic and includes all feeds in both artifacts', async () => {
  const catalog = makeCatalog();
  assert.equal(renderOpml(catalog), renderOpml(structuredClone(catalog)));
  assert.equal(renderReadme(catalog), renderReadme(structuredClone(catalog)));
  assert.equal((renderOpml(catalog).match(/type="rss"/g) || []).length, catalog.feeds.length);
  for (const feed of catalog.feeds) assert.ok(renderReadme(catalog).includes(`](${feed.feed})`));
});

test('Bluesky subscriptions occupy their own top-level OPML folder', async () => {
  const catalog = makeCatalog();
  const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: '', isArray: name => name === 'outline'});
  const folders = parser.parse(renderOpml(catalog)).opml.body.outline;
  const socialFeeds = catalog.feeds.filter(feed => feed.category === 'bluesky');
  const folder = folders.find(folder => folder.title === 'Bluesky');
  assert.ok(socialFeeds.length > 0);
  assert.deepEqual(new Set(folder.outline.map(feed => feed.xmlUrl)), new Set(socialFeeds.map(feed => feed.feed)));
  assert.ok(folder.outline.every(feed => /^https:\/\/bsky\.app\/profile\/did:[^/]+\/rss$/.test(feed.xmlUrl)));
  assert.ok(folders.filter(folder => folder.title !== 'Bluesky').every(folder => folder.outline.every(feed => !feed.xmlUrl.startsWith('https://bsky.app/'))));
});
