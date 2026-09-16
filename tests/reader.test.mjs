import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFeed, safeUrl, verifyOpml, nextRefresh, inBatches, selectedSources, archiveUrl} from '../web/src/feeds.mjs';
import {renderOpml} from '../scripts/render.mjs';
import {makeCatalog, makeSource} from './fixtures/catalog.mjs';
import {rssFeed, atomFeed, postItem, NOW} from './fixtures/feeds.mjs';

const source = makeSource();
test('archive searches encode the complete URL once, remove UTM parameters, and preserve article query parameters', () => {
  const url = archiveUrl('https://example.com/a%20story?utm_source=rss&article=42&UTM_medium=feed&utm_source=duplicate&q=a%26b#comments');
  const search = new URL(url);
  assert.equal(search.origin + search.pathname, 'https://ghostarchive.org/search');
  assert.equal(search.searchParams.get('go'), 'Go');
  assert.equal(search.searchParams.get('term'), 'https://example.com/a%20story?article=42&q=a%26b');
  assert.equal(archiveUrl('https://example.com/story'), 'https://ghostarchive.org/search?go=Go&term=https%3A%2F%2Fexample.com%2Fstory');
  for (const unsafe of ['javascript:alert(1)', 'https://user:secret@example.com', '', '/relative']) assert.equal(archiveUrl(unsafe), '');
});
test('RSS content namespaces, stable deduplication, and unordered dates survive normalization', () => {
  const rss = rssFeed([
    {title: 'Old', url: 'https://publisher.example/old', published: 'Tue, 16 Jan 2024 09:00:00 GMT'},
    {title: 'New', url: 'https://publisher.example/new?utm_source=rss', html: '<p>Full story</p>'},
    {title: 'New', url: 'https://publisher.example/new', html: '<p>Full story</p>'},
  ]).replace('<title>News</title>', '<title/>');
  const articles = normalizeFeed(rss, source, Date.parse(NOW));
  assert.equal(articles.length, 2); assert.equal(articles[1].id, 'https://publisher.example/new'); assert.equal(articles[1].html, '<p>Full story</p>'); assert.ok(articles[1].published > articles[0].published);
});
test('Atom alternate links and relative URLs work; unsafe URLs are never navigable', () => {
  const atom = atomFeed([{url: null, updated: 'invalid', html: '<p>Hello</p>', extraXml: '<link rel="self" href="/api/1"/><link rel="alternate" href="/story"/>'}]);
  const [article] = normalizeFeed(atom, source, Date.parse(NOW)); assert.equal(article.url, 'https://publisher.example/story'); assert.equal(article.published, 0); assert.equal(article.html, '<p>Hello</p>');
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://user:pass@example.com', 'file:///secret']) assert.equal(safeUrl(url), '');
});
test('empty feeds, HTML challenge pages, DTDs, and mismatched OPML are rejected', () => {
  assert.throws(() => normalizeFeed('<html>Challenge</html>', source));
  assert.throws(() => normalizeFeed('<!DOCTYPE rss><rss/>', source));
  assert.throws(() => normalizeFeed(rssFeed([]), source));
  const catalog = makeCatalog(); const opml = renderOpml(catalog);
  assert.equal(verifyOpml(opml, catalog), catalog);
  assert.throws(() => verifyOpml(opml.replace(catalog.feeds[0].feed, 'https://example.com/wrong'), catalog));
});
test('refresh failures back off and network concurrency stays bounded', async () => {
  assert.equal(nextRefresh(0, 0), 900000); assert.equal(nextRefresh(1, 0), 1800000); assert.equal(nextRefresh(30, 0), 21600000);
  let active = 0, maximum = 0; const done = [];
  await inBatches(Array.from({length: 12}, (_, i) => i), async item => {active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); done.push(item); active--;}, 3);
  assert.equal(maximum, 3); assert.equal(new Set(done).size, 12);
});

test('social sources are separate from default news but selectable individually or by section', () => {
  const sources = [makeSource({id: 'news'}), makeSource({id: 'social', category: 'bluesky'})];
  assert.deepEqual(selectedSources(sources).map(feed => feed.id), ['news']);
  assert.deepEqual(selectedSources(sources, {category: 'bluesky'}).map(feed => feed.id), ['social']);
  assert.deepEqual(selectedSources(sources, {source: 'social'}).map(feed => feed.id), ['social']);
  assert.equal(selectedSources(sources, {includeSocial: true}).length, 2);
});

test('native Bluesky posts get readable titles, literal text, and identity stable across handle changes', () => {
  // Preserve literal XML entities here: their decoding is the regression case.
  const post = rssFeed([postItem('123', {text: null, extraXml: '<description>Local news &lt;3&#xA;Next line &amp; details.</description>'})]);
  const socialSource = makeSource({id: 'bluesky-reporter', category: 'bluesky'});
  const [article] = normalizeFeed(post, socialSource, Date.parse(NOW));
  assert.equal(article.title, 'Local news &lt;3 Next line &amp; details.');
  assert.equal(article.html, '<p>Local news &lt;3<br>Next line &amp; details.</p>');
  assert.ok(article.published > 0);
  assert.equal(article.id, normalizeFeed(post.replace('reporter.example', 'new.example'), socialSource, Date.parse(NOW))[0].id);
  const longPost = post.replace('Local news &lt;3&#xA;Next line &amp; details.', 'Neighborhood news and transportation updates. '.repeat(8));
  const [preview] = normalizeFeed(longPost, socialSource, Date.parse(NOW));
  assert.ok(preview.title.length <= 160);
  assert.ok(['Neighborhood', 'news', 'and', 'transportation', 'updates.'].includes(preview.title.split(' ').at(-1)));
});
