import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFeed, safeUrl, verifyOpml, nextRefresh, inBatches, selectedSources} from '../web/src/feeds.mjs';
import {loadCatalog} from '../scripts/catalog.mjs';
import {renderOpml} from '../scripts/render.mjs';

const source = {id: 'example', website: 'https://example.com'};
test('RSS content namespaces, stable deduplication, and unordered dates survive normalization', () => {
  const rss = '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title></title><description>News</description><item><title>Old</title><link>https://example.com/old</link><pubDate>Tue, 16 Jan 2024 09:00:00 GMT</pubDate></item><item><title>New</title><link>https://example.com/new?utm_source=rss</link><pubDate>Tue, 15 Sep 2026 09:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Full story</p>]]></content:encoded></item><item><title>New</title><link>https://example.com/new</link><pubDate>Tue, 15 Sep 2026 09:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Full story</p>]]></content:encoded></item></channel></rss>';
  const articles = normalizeFeed(rss, source, Date.parse('2026-09-15T20:00:00Z'));
  assert.equal(articles.length, 2); assert.equal(articles[1].id, 'https://example.com/new'); assert.equal(articles[1].html, '<p>Full story</p>'); assert.ok(articles[1].published > articles[0].published);
});
test('Atom alternate links and relative URLs work; unsafe URLs are never navigable', () => {
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><id>example</id><title>News</title><updated>2026-09-15T10:00:00Z</updated><entry><id>1</id><title>Story</title><updated>invalid</updated><link rel="self" href="/api/1"/><link rel="alternate" href="/story"/><content type="html">&lt;p&gt;Hello&lt;/p&gt;</content></entry></feed>';
  const [article] = normalizeFeed(atom, source); assert.equal(article.url, 'https://example.com/story'); assert.equal(article.published, 0); assert.equal(article.html, '<p>Hello</p>');
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://user:pass@example.com', 'file:///secret']) assert.equal(safeUrl(url), '');
});
test('empty feeds, HTML challenge pages, DTDs, and mismatched OPML are rejected', async () => {
  assert.throws(() => normalizeFeed('<html>Challenge</html>', source));
  assert.throws(() => normalizeFeed('<!DOCTYPE rss><rss/>', source));
  assert.throws(() => normalizeFeed('<rss version="2.0"><channel><title>Empty</title><description>Empty</description></channel></rss>', source));
  const catalog = await loadCatalog(); const opml = renderOpml(catalog);
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
  const sources = [{id: 'news', category: 'regional'}, {id: 'social', category: 'bluesky'}];
  assert.deepEqual(selectedSources(sources).map(feed => feed.id), ['news']);
  assert.deepEqual(selectedSources(sources, {category: 'bluesky'}).map(feed => feed.id), ['social']);
  assert.deepEqual(selectedSources(sources, {source: 'social'}).map(feed => feed.id), ['social']);
  assert.equal(selectedSources(sources, {includeSocial: true}).length, 2);
});

test('native Bluesky posts get readable titles, literal text, and identity stable across handle changes', () => {
  const post = '<rss version="2.0"><channel><title>Example</title><description>Posts</description><item><link>https://bsky.app/profile/old.example/post/123</link><description>Local news &lt;3&#xA;Next line &amp; details.</description><pubDate>15 Sep 2026 20:00 +0000</pubDate><guid isPermaLink="false">at://did:plc:example/app.bsky.feed.post/123</guid></item></channel></rss>';
  const socialSource = {...source, category: 'bluesky'};
  const [article] = normalizeFeed(post, socialSource);
  assert.equal(article.title, 'Local news &lt;3 Next line &amp; details.');
  assert.equal(article.html, '<p>Local news &lt;3<br>Next line &amp; details.</p>');
  assert.ok(article.published > 0);
  assert.equal(article.id, normalizeFeed(post.replace('old.example', 'new.example'), socialSource)[0].id);
  const longPost = post.replace('Local news &lt;3&#xA;Next line &amp; details.', 'Neighborhood news and transportation updates. '.repeat(8));
  const [preview] = normalizeFeed(longPost, socialSource);
  assert.ok(preview.title.length <= 160);
  assert.ok(['Neighborhood', 'news', 'and', 'transportation', 'updates.'].includes(preview.title.split(' ').at(-1)));
});
