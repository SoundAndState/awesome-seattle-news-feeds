import test from 'node:test';
import assert from 'node:assert/strict';
import {messages, formatMessage, messageParts, countMessage} from '../web/src/localization.mjs';
import {normalizeSiteConfig, site} from '../web/src/site-config.mjs';
import {loadFeed, feedFailureKind} from '../web/src/network.mjs';
import {normalizeFeed} from '../web/src/feeds.mjs';
import {makeSource} from './fixtures/catalog.mjs';
import {rssFeed} from './fixtures/feeds.mjs';

test('messages support reordered and repeated placeholders without interpreting replacement text', () => {
  assert.equal(formatMessage('{title}: {count} — {title}', {title:'<img src=x> {count}', count:3}), '<img src=x> {count}: 3 — <img src=x> {count}');
  assert.throws(() => formatMessage('Hello {name}'), /Missing message value: name/);
  assert.throws(() => formatMessage('{toString}', {}), /Missing message value/);
  const link = {type:'a', props:{children:'Feed list'}};
  assert.deepEqual(messageParts('Use {link}.', {link}), ['Use ', link, '.']);
});

test('English counts choose whole singular and plural messages and format large numbers', () => {
  assert.equal(countMessage(messages.counts.articles, 0), '0 articles');
  assert.equal(countMessage(messages.counts.articles, 1), '1 article');
  assert.equal(countMessage(messages.showNewItems.posts, 2), 'Show 2 new posts');
  assert.equal(countMessage(messages.counts.saved, 1200), '1,200 saved items');
});

test('the default brand comes from English copy while alternate readers keep their own disclosures', () => {
  assert.equal(site.name, messages.site.name);
  assert.deepEqual(site.about, messages.site.about);
  const alternate = normalizeSiteConfig({name:'Community Reader', title:'Community updates', description:'Fictional local posts.', storageNamespace:'community', url:'https://reader.example/'});
  assert.equal(alternate.name, 'Community Reader');
  assert.equal(alternate.homeLabel, 'Community Reader home');
  assert.equal(alternate.about.hosting, '');
  assert.deepEqual(alternate.categoryLabels, {});
});

test('custom error copy does not change the classification of feed failures', async () => {
  const original = {...messages.network};
  const source = makeSource();
  try {
    messages.network.timeout = 'Waiting ended.';
    messages.network.httpError = 'Response {status}.';
    messages.network.parseError = 'Unable to decode: {message}';
    for (const [response, kind] of [
      [() => {throw new DOMException('test', 'TimeoutError');}, 'timeout'],
      [() => new Response('', {status:403}), 'refused'],
      [() => new Response('<html>not a feed</html>'), 'invalid-feed'],
    ]) await assert.rejects(loadFeed(source, '', {fetchImpl:async () => response()}), error => {
      assert.equal(feedFailureKind(error), kind);
      assert.ok(!error.message.includes('undefined'));
      return true;
    });
  } finally {Object.assign(messages.network, original);}
});

test('editing untitled copy preserves legacy IDs for feeds without links or GUIDs', () => {
  const originalStory = messages.common.untitledStory, originalPost = messages.feeds.untitledPost;
  const body = rssFeed([{title:null, url:null, text:''}]);
  const article = makeSource(), post = makeSource({id:'bluesky-local', category:'bluesky'});
  const before = [article, post].map(source => normalizeFeed(body, source)[0]);
  try {
    messages.common.untitledStory = 'Headline unavailable';
    messages.feeds.untitledPost = 'Text unavailable';
    const after = [article, post].map(source => normalizeFeed(body, source)[0]);
    assert.deepEqual(after.map(item => item.id), before.map(item => item.id));
    assert.deepEqual(after.map(item => item.title), ['Headline unavailable', 'Text unavailable']);
  } finally {messages.common.untitledStory = originalStory; messages.feeds.untitledPost = originalPost;}
});
