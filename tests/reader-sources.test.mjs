import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {normalizeCatalog} from '../web/src/catalog.mjs';
import {normalizeSiteConfig, site} from '../web/src/site-config.mjs';
import {loadReaderConfig} from '../config/reader-config.mjs';
import {normalizeFeed} from '../web/src/feeds.mjs';
import {feedMode, itemMode, normalizeRoute} from '../web/src/reader-state.mjs';
import {loadFeed} from '../web/src/network.mjs';
import {readingBackup, restoreReadingBackup} from '../web/src/backup.mjs';
import {makeCatalog, makeSource} from './fixtures/catalog.mjs';
import {jsonFeed, postsJson} from './fixtures/json-feeds.mjs';
import {NOW} from './fixtures/feeds.mjs';

test('reader catalogs validate the network boundary and preserve explicit source kinds', () => {
  const source = makeSource({kind: 'posts', format: 'posts-json', platform: 'Community updates'});
  const catalog = normalizeCatalog(makeCatalog({feeds: [source]}));
  assert.equal(catalog.feeds[0].kind, 'posts');
  assert.equal(catalog.feeds[0].platform, 'Community updates');
  assert.equal(normalizeCatalog(makeCatalog()).feeds.at(-1).kind, 'posts');
  for (const update of [{kind: 'video'}, {format: 'script'}, {id: '../secret'}, {feed: 'https://user:secret@publisher.example/rss'}, {feed: 'http://publisher.example/rss'}, {category: 'missing'}, {redirects: ['javascript:alert(1)']}]) {
    assert.throws(() => normalizeCatalog(makeCatalog({feeds: [{...source, ...update}]})));
  }
  assert.throws(() => normalizeCatalog(makeCatalog({feeds: [source, source]})), /duplicate/);
  assert.throws(() => normalizeCatalog({feeds: []}));
  assert.throws(() => normalizeCatalog({...makeCatalog(), schemaVersion: 2}), /version/);
  assert.throws(() => normalizeCatalog(makeCatalog({feeds: [{...source, id: 'a'.repeat(121)}]})), /source ID/);
});

test('post identity and category filters work outside Bluesky and after source removal', () => {
  const source = makeSource({kind: 'posts'});
  const feeds = new Map([[source.id, source]]);
  const categories = new Map([['regional', {id: 'regional'}]]);
  assert.equal(feedMode(source), 'posts');
  assert.equal(feedMode({...source, kind: 'articles', category: 'bluesky'}), 'articles');
  const route = normalizeRoute({source: source.id, category: 'regional'}, feeds, categories);
  assert.equal(route.mode, 'posts');
  assert.equal(route.category, 'regional');
  assert.equal(itemMode({id: 'post-1', kind: 'posts', feedIds: ['removed-source']}, new Map()), 'posts');
});

test('JSON Feed 1.1 preserves dates and authors and escapes text as text', () => {
  const source = makeSource({format: 'json-feed'});
  const [item] = normalizeFeed(jsonFeed([{title: 'News <3 & updates', content_text: '<script>alert(1)</script>\nTown & country', authors: [{name: 'Alex'}, {name: 'Alex'}, {url: 'https://publisher.example/person'}]}]), source, Date.parse(NOW));
  assert.equal(item.kind, 'articles');
  assert.equal(item.author, 'Alex');
  assert.equal(item.title, 'News &lt;3 &amp; updates');
  assert.ok(item.published > 0 && item.updated > 0);
  assert.equal(item.html, '<p>&lt;script&gt;alert(1)&lt;/script&gt;<br>Town &amp; country</p>');
  const [html] = normalizeFeed(jsonFeed([{content_html: '<p>Original HTML</p>'}]), source);
  assert.equal(html.html, '<p>Original HTML</p>');
  for (const body of [jsonFeed([{id: null}]), jsonFeed([{date_published: 42}]), jsonFeed([{content_text: undefined}]), '{"items":[]}', '[]']) assert.throws(() => normalizeFeed(body, source));
});

test('curated posts JSON keeps a stable linkless identity across edits and safe URLs', () => {
  const source = makeSource({kind: 'posts', format: 'posts-json'});
  const [first] = normalizeFeed(postsJson([{url: undefined, text: 'A local update <3\nNext line.'}]), source);
  const [updated] = normalizeFeed(postsJson([{url: undefined, text: 'An edited update.'}]), source);
  assert.equal(first.id, updated.id);
  assert.equal(first.kind, 'posts');
  assert.equal(first.title, 'A local update &lt;3 Next line.');
  assert.equal(first.html, '<p>A local update &lt;3<br>Next line.</p>');
  assert.equal(first.author, 'Local Reporter');
  const [unsafe] = normalizeFeed(postsJson([{url: 'javascript:alert(1)'}]), source);
  assert.equal(unsafe.url, '');
  for (const body of ['{"version":2,"posts":[]}', postsJson([{id: 42}]), postsJson([{text: undefined}])]) assert.throws(() => normalizeFeed(body, source));
  assert.deepEqual(normalizeFeed(postsJson([]), source), []);
  assert.deepEqual(normalizeFeed(jsonFeed([]), {...source, format: 'json-feed'}), []);
});

test('direct-only JSON sources never construct a proxy request and reject unsafe destinations', async () => {
  const feed = makeSource({format: 'json-feed'});
  const requests = [];
  const result = await loadFeed(feed, '', {fetchImpl: async (url, options) => {
    requests.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    return new Response(jsonFeed());
  }});
  assert.equal(result.transport, 'direct');
  assert.deepEqual(requests, [feed.feed]);
  await assert.rejects(loadFeed({...feed, id: '../other'}, 'https://proxy.example'), /invalid feed ID/);
  await assert.rejects(loadFeed({...feed, feed: 'http://publisher.example/rss'}, ''), /HTTPS/);
});

test('canonical and linkless item identities fit the backup contract at its boundary', () => {
  const source = makeSource({kind: 'posts', format: 'posts-json'});
  const urlPrefix = 'https://publisher.example/';
  for (const post of [
    {id: 'x'.repeat(4096 - source.id.length - 1), url: undefined},
    {id: 'short-id', url: urlPrefix + 'x'.repeat(4096 - urlPrefix.length)},
  ]) {
    const [item] = normalizeFeed(postsJson([post]), source);
    assert.equal(item.id.length, 4096);
    const data = readingBackup({states: new Map([[item.id, {id: item.id, saved: true}]]), articles: new Map([[item.id, {...item, sourceName: source.name}]])}, site);
    const restored = restoreReadingBackup(data, {states: new Map(), articles: new Map()}, String, site);
    assert.equal(restored.articles[0].id, item.id);
    const oversized = post.url ? {...post, url: `${post.url}x`} : {...post, id: `${post.id}x`};
    assert.throws(() => normalizeFeed(postsJson([oversized]), source), /identity exceeds/);
  }
});

test('service base URLs reject queries and fragments before any network request', async () => {
  let requests = 0;
  const fetchImpl = async () => {requests++; return new Response(jsonFeed());};
  const source = makeSource({format: 'json-feed'});
  for (const suffix of ['?mode=reader', '#reader', '?', '#']) {
    const proxy = `https://service.example/api${suffix}`;
    assert.throws(() => normalizeSiteConfig({...site, proxy}), /query or fragment/);
    await assert.rejects(loadFeed(source, proxy, {fetchImpl}), /query or fragment/);
  }
  assert.equal(requests, 0);
  const urls = [];
  await loadFeed(source, 'https://service.example/api/', {fetchImpl: async url => {urls.push(url); return new Response(jsonFeed());}});
  assert.deepEqual(urls, [`https://service.example/api/feed/${source.id}`]);
});

test('brand settings retain the Seattle library and require safe asset and storage configuration', () => {
  assert.equal(site.storageNamespace, 'sound-and-state');
  const config = normalizeSiteConfig({...site, name: 'Topic Reader', storageNamespace: 'topic-reader', proxy: '', theme: 'blue'});
  assert.equal(config.name, 'Topic Reader');
  assert.equal(config.proxy, '');
  assert.equal(config.theme, 'blue');
  for (const update of [{storageNamespace: ''}, {theme: 'script'}, {base: '//external/'}, {assets: {logo: 'https://tracker.example/logo.svg'}}, {proxy: 'https://user:pass@proxy.example'}, {capabilities: {articles: false, posts: false}}]) assert.throws(() => normalizeSiteConfig({...site, ...update}));
});

test('alternate site build resolves its own catalog and exact CSP origins without changing the editorial catalog', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-config-'));
  try {
    const configPath = path.join(directory, 'site.json');
    const source = makeSource({kind: 'posts', format: 'posts-json', redirects: ['https://cdn.publisher.example/exact/posts.json']});
    await fs.writeFile(path.join(directory, 'sources.json'), JSON.stringify(makeCatalog({feeds: [source]})));
    const config = {...site, name: 'Neighborhood Posts', storageNamespace: 'neighborhood-posts', proxy: '', catalog: './sources.json'};
    await fs.writeFile(configPath, JSON.stringify(config));
    const build = await loadReaderConfig(configPath);
    assert.deepEqual(build.origins, ['https://cdn.publisher.example', 'https://publisher.example']);
    assert.equal(build.site.storageNamespace, 'neighborhood-posts');
    assert.equal(build.catalog.feeds[0].format, 'posts-json');
    await fs.writeFile(configPath, JSON.stringify({...config, storageNamespace: 'sound-and-state'}));
    await assert.rejects(loadReaderConfig(configPath), /own storageNamespace/);
  } finally {await fs.rm(directory, {recursive: true, force: true});}
});
