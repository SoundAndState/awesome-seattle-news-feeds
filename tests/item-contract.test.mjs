import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFeed} from '../web/src/feeds.mjs';
import {adapters} from '../web/src/source-adapters/index.mjs';
import {SOURCE_FORMATS} from '../web/src/source-model.mjs';
import {ITEM_LIMITS, validateItem, prepareItem, mergeSourceItem, itemMode} from '../web/src/item-model.mjs';
import {readingBackup, restoreReadingBackup} from '../web/src/backup.mjs';
import {makeSource} from './fixtures/catalog.mjs';
import {contractFormats, contractFeed, contractNow} from './fixtures/source-contracts.mjs';
import {rssFeed, postItem, postId} from './fixtures/feeds.mjs';
import {jsonFeed} from './fixtures/json-feeds.mjs';

const site = {storageNamespace: 'fixture-reader'};
// Unit cases test structure/identity with a deterministic text dependency.
// Real DOMPurify behavior is covered for every format in the browser matrix.
const plain = text => String(text).replace(/<[^>]*>/g, '');
const emptyLibrary = () => ({states: new Map(), articles: new Map()});

test('catalog formats and concrete adapters stay in agreement', () => {
  assert.deepEqual(Object.keys(adapters).sort(), SOURCE_FORMATS.filter(format => format !== 'auto').sort());
  assert.deepEqual(contractFormats.slice().sort(), Object.keys(adapters).sort());
});

for (const format of contractFormats) {
  const source = makeSource({id: `contract-${format}`, format, kind: 'articles'});
  const parse = overrides => normalizeFeed(contractFeed(format, overrides), source, contractNow)[0];

  test(`${format}: common item fields and saved/read marks round-trip through backup`, () => {
    const parsed = parse();
    const item = mergeSourceItem(undefined, parsed, source, new Map([[source.id, source]]), plain);
    validateItem(item, {requireSourceName: true});
    assert.equal(item.id, 'https://publisher.example/story');
    assert.equal(item.title, 'Community reporting');
    assert.equal(item.excerpt, 'Local reporting.');
    assert.equal(item.author, 'Alex Reporter');
    assert.equal(item.sourceName, source.name);
    assert.equal(item.firstSeen, contractNow);
    assert.equal(item.kind, 'articles');
    assert.ok(item.published > 0 && item.updated > item.published);
    const states = new Map([[item.id, {id: item.id, saved: true, read: true}]]);
    const backup = readingBackup({states, articles: new Map([[item.id, item]])}, site);
    const restored = restoreReadingBackup(backup, emptyLibrary(), plain);
    assert.deepEqual(restored.articles, [item]);
    assert.deepEqual(restored.states, [...states.values()]);
  });

  test(`${format}: edits, relative/unsafe links, absent dates and date-only values share the contract`, () => {
    assert.equal(parse({url: null}).id, `${source.id}:stable-story`);
    assert.equal(parse({url: null, title: 'Edited title', html: '<p>Edited content</p>'}).id, `${source.id}:stable-story`);
    assert.equal(parse({url: '/relative'}).url, 'https://publisher.example/relative');
    for (const url of ['javascript:alert(1)', 'https://user:secret@publisher.example/story', 'data:text/html,unsafe']) {
      const item = parse({url}); assert.equal(item.url, ''); assert.equal(item.id, `${source.id}:stable-story`);
    }
    const undated = parse({published: null, updated: null});
    assert.equal(undated.published, 0); assert.equal(undated.updated, 0);
    const updated = parse({published: 'invalid', updated: '2026-09-15'});
    assert.equal(updated.published, 0); assert.equal(updated.updated, Date.parse('2026-09-15')); assert.equal(updated.updatedDateOnly, true);
    const published = parse({published: '2026-09-14', updated: '2999-01-01'});
    assert.equal(published.publishedDateOnly, true); assert.equal(published.updated, 0);
  });

  test(`${format}: item limits and linkless identity agree with backup limits`, () => {
    const id = 'x'.repeat(ITEM_LIMITS.id - source.id.length - 1);
    const item = parse({id, url: null, title: 't'.repeat(ITEM_LIMITS.title + 1), html: 'h'.repeat(ITEM_LIMITS.html + 1), author: 'a'.repeat(ITEM_LIMITS.author + 1)});
    assert.equal(item.id.length, ITEM_LIMITS.id);
    assert.equal(item.title.length, ITEM_LIMITS.title);
    assert.equal(item.html.length, ITEM_LIMITS.html);
    assert.equal(item.author.length, ITEM_LIMITS.author);
    const prepared = prepareItem({...item, sourceName: source.name}, plain);
    const backup = readingBackup({states: new Map([[item.id, {id: item.id, saved: true}]]), articles: new Map([[item.id, prepared]])}, site);
    assert.equal(restoreReadingBackup(backup, emptyLibrary(), plain).articles[0].id, item.id);
    assert.throws(() => parse({id: `${id}x`, url: null}), /identity exceeds/);
  });

  test(`${format}: malformed input fails before returning a partial set of items`, () => {
    assert.throws(() => normalizeFeed('{broken', source, contractNow));
    assert.throws(() => normalizeFeed('<html>Publisher challenge</html>', source, contractNow));
    const invalid = format === 'rss' || format === 'atom' ? '<!DOCTYPE rss>' + contractFeed(format) : contractFeed(format, {id: 42});
    assert.throws(() => normalizeFeed(invalid, source, contractNow));
    assert.throws(() => normalizeFeed(contractFeed(format, [{}, {url: null, id: 'x'.repeat(ITEM_LIMITS.id + 1)}]), source, contractNow));
  });

  test(`${format}: repeated canonical URLs and feed-size limits use the common policy`, () => {
    const repeated = normalizeFeed(contractFeed(format, [{title: 'First'}, {title: 'Updated', url: 'https://publisher.example/story?fbclid=click#other'}]), source, contractNow);
    assert.equal(repeated.length, 1); assert.equal(repeated[0].title, 'Updated');
    const many = Array.from({length: ITEM_LIMITS.perFeed + 1}, (_, i) => ({id: `entry-${i}`, url: `https://publisher.example/${i}`}));
    assert.equal(normalizeFeed(contractFeed(format, many), source, contractNow).length, ITEM_LIMITS.perFeed);
  });
}

test('every format pair retains article content, ordered provenance, and first arrival across kind changes', () => {
  for (const articleFormat of contractFormats) for (const postFormat of contractFormats) {
    const news = makeSource({id: `news-${articleFormat}`, format: articleFormat, kind: 'articles'});
    const posts = makeSource({id: `posts-${postFormat}`, format: postFormat, kind: 'posts'});
    const feedMap = new Map([[news.id, news], [posts.id, posts]]);
    for (const order of [[news, posts], [posts, news]]) {
      let merged;
      order.forEach((source, index) => {
        const incoming = normalizeFeed(contractFeed(source.format, {title: source.kind === 'articles' ? 'Original reporting' : 'A linked post'}), source, contractNow + index)[0];
        const before = merged && structuredClone(merged);
        const next = mergeSourceItem(merged, incoming, source, feedMap, plain);
        if (before) assert.deepEqual(merged, before);
        merged = next;
      });
      assert.equal(merged.title, 'Original reporting');
      assert.equal(merged.kind, 'articles');
      assert.equal(merged.sourceName, news.name);
      assert.equal(merged.firstSeen, contractNow);
      assert.deepEqual(merged.feedIds, [news.id, posts.id]);
    }
  }
});

test('legacy linkless and native Bluesky identities survive without modernizing stored IDs', () => {
  const news = makeSource();
  const [fallback] = normalizeFeed(rssFeed([{id: null, url: null, title: 'Old title', published: '2026-09-14'}]), news, contractNow);
  assert.equal(fallback.id, `${news.id}:Old title:2026-09-14`);
  const posts = makeSource({id: 'bluesky-reporter', category: 'bluesky'});
  const [post] = normalizeFeed(rssFeed([postItem('legacy')]), posts, contractNow);
  assert.equal(post.id, postId('legacy'));
  const old = {...post, sourceName: posts.name};
  delete old.kind; delete old.updated; delete old.author; delete old.updatedDateOnly; delete old.publishedDateOnly;
  const backup = readingBackup({states: new Map([[old.id, {id: old.id, saved: true}]]), articles: new Map([[old.id, old]])}, site);
  const restored = restoreReadingBackup(backup, emptyLibrary(), plain).articles[0];
  assert.equal(restored.id, old.id); assert.equal(restored.kind, undefined);
  assert.equal(itemMode(restored, new Map()), 'posts');
  assert.equal(restored.updated, 0);
});

test('JSON Feed ignores unrelated format fields and preserves its declared authors and dates', () => {
  const source = makeSource({format: 'json-feed'});
  const [item] = normalizeFeed(jsonFeed([{pubDate: '2020-01-01', content: {encoded: '<p>Not JSON Feed content</p>'}, dc: {creators: ['Other format author']}, authors: [{name: 'JSON author'}]}]), source, contractNow);
  assert.equal(item.author, 'JSON author');
  assert.equal(item.html, '<p>A neighborhood update.</p>');
  assert.notEqual(item.published, Date.parse('2020-01-01'));
  for (const invalid of [null, [], 42, 'item']) {
    assert.throws(() => normalizeFeed(JSON.stringify({version: 'https://jsonfeed.org/version/1.1', title: 'News', items: [invalid]}), source, contractNow));
  }
});

test('JSON Feed 1.0 and 1.1 inherit author names while preserving item overrides', () => {
  for (const version of ['https://jsonfeed.org/version/1', 'https://jsonfeed.org/version/1.1']) {
    const source = makeSource({format: 'json-feed'});
    const data = {version, title: 'News', author: {name: 'Feed author'}, items: [
      {id: 'inherited', content_text: 'First'},
      {id: 'override', content_text: 'Second', author: {name: 'Item author'}},
      {id: 'anonymous', content_text: 'Third', authors: []},
    ]};
    assert.deepEqual(normalizeFeed(JSON.stringify(data), source, contractNow).map(item => item.author), ['Feed author', 'Item author', '']);
  }
});

test('provenance limits are shared with backups and invalid imports leave the library untouched', () => {
  const source = makeSource({format: 'rss'});
  const item = prepareItem({...normalizeFeed(contractFeed('rss'), source, contractNow)[0], sourceName: source.name}, plain);
  const current = emptyLibrary();
  const backup = readingBackup({states: new Map([[item.id, {id: item.id, saved: true}]]), articles: new Map([[item.id, item]])}, site);
  for (const update of [{id: 'x'.repeat(ITEM_LIMITS.id + 1)}, {html: 'x'.repeat(ITEM_LIMITS.html + 1)}, {feedIds: ['x'.repeat(ITEM_LIMITS.feedId + 1)]}, {feedIds: Array(ITEM_LIMITS.feedIds + 1).fill('source')}, {updated: Infinity}, {kind: 'video'}]) {
    assert.throws(() => validateItem({...item, ...update}));
    assert.throws(() => restoreReadingBackup({...backup, savedArticles: [item, {...item, ...update}]}, current, plain));
    assert.equal(current.articles.size, 0); assert.equal(current.states.size, 0);
  }
  const filled = {...item, feedIds: Array.from({length: ITEM_LIMITS.feedIds}, (_, i) => `source-${i}`)};
  assert.throws(() => mergeSourceItem(filled, item, source, new Map(), plain));
  assert.equal(filled.feedIds.length, ITEM_LIMITS.feedIds);
  assert.throws(() => mergeSourceItem(item, {...item, id: 'different'}, source, new Map(), plain), /same identity/);
});
