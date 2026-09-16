import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotResponse, snapshotLifetime, MAX_SNAPSHOT_AGE} from '../proxy/snapshots.mjs';
import {collectSnapshot} from '../scripts/refresh-snapshots.mjs';
import {createHandler} from '../proxy/worker.mjs';

const feed = {id: 'king-5-local', feed: 'https://publisher.example/rss', website: 'https://publisher.example'};
const xml = '<rss version="2.0"><channel><title>Local news</title><item><title>News</title><link>https://publisher.example/story</link></item></channel></rss>';
const now = Date.UTC(2026, 8, 15, 12);
const value = {url: feed.feed, xml, fetchedAt: now - 1000000, freshUntil: now - 900000, expiresAt: now + 3600000};
const headers = new Headers({'Access-Control-Allow-Origin': 'https://soundandstate.com', Vary: 'Origin'});
const store = object => ({get: async () => object});

test('fallback snapshots carry collection time and expire, with publisher revalidation respected', async () => {
  const response = await snapshotResponse(feed, feed.id, store(value), headers, now);
  assert.equal(response.status, 200); assert.equal(await response.text(), xml);
  assert.equal(response.headers.get('x-feed-stale'), 'true');
  assert.equal(response.headers.get('x-feed-transport'), 'snapshot');
  assert.equal(response.headers.get('x-feed-fetched-at'), new Date(value.fetchedAt).toISOString());
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://soundandstate.com');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
  assert.deepEqual(snapshotLifetime(new Headers({'Cache-Control': 'max-age=300'}), now), {freshUntil: now+300000, expiresAt: now+MAX_SNAPSHOT_AGE});
  for (const restriction of ['must-revalidate', 'proxy-revalidate', 's-maxage=300']) assert.equal(snapshotLifetime(new Headers({'Cache-Control': `max-age=300, ${restriction}`}), now).expiresAt, now+300000);
  for (const directive of ['no-store', 'private', 'no-cache', 'max-age=0']) assert.equal(snapshotLifetime(new Headers({'Cache-Control': directive}), now), null);
  assert.equal(snapshotLifetime(new Headers({'Cache-Control':'max-age=300, stale-if-error=60'}), now).expiresAt, now+360000);
  assert.equal(snapshotLifetime(new Headers({'Cache-Control':'public, max-age=0, s-maxage=3600','Set-Cookie':'incidental=1'}), now).expiresAt, now+3600000);
});

test('expired, mismatched, invalid or unapproved snapshots never reach the reader', async () => {
  for (const bad of [null, {...value, expiresAt:now}, {...value, fetchedAt:now+1}, {...value, fetchedAt:now-MAX_SNAPSHOT_AGE}, {...value, url:'https://other.example/rss'}, {...value, xml:'<html>challenge</html>'}, {...value, xml:'<!DOCTYPE rss>'+xml}, {...value, xml:'x'.repeat(5*1024*1024+1)}]) {
    assert.equal(await snapshotResponse(feed, feed.id, store(bad), headers, now), null);
  }
  assert.equal(await snapshotResponse(feed, 'unapproved', {get:()=>assert.fail('unapproved lookup')}, headers, now), null);
});

test('collector checks exact redirects, parses XML, and will not store private or invalid responses', async () => {
  const result = await collectSnapshot(feed, {now:()=>now, fetcher: async () => new Response(xml, {headers:{'Cache-Control':'max-age=300'}})});
  assert.equal(result.items, 1); assert.equal(result.url, feed.feed); assert.equal(result.xml, xml);
  for (const fetcher of [async()=>new Response(xml,{headers:{'Cache-Control':'private'}}), async()=>new Response('<html>challenge</html>'), async()=>new Response(null,{status:301,headers:{Location:'https://www.youtube.com/@KING5Seattle'}})]) await assert.rejects(collectSnapshot(feed,{fetcher}));
});

test('proxy uses approved snapshots only after an upstream failure and tolerates storage outages', async () => {
  const freshValue = {...value, fetchedAt:Date.now()-1000, freshUntil:Date.now()+60000, expiresAt:Date.now()+3600000};
  const request = new Request(`https://proxy.example/feed/${feed.id}`);
  const options = {feedMap:new Map([[feed.id,feed]])};
  const denied = createHandler({...options,fetcher:async()=>new Response('',{status:403})});
  const cached = await denied(request, {FEED_SNAPSHOTS:store(freshValue)});
  assert.equal(cached.status,200); assert.equal(cached.headers.get('x-feed-transport'),'snapshot');
  const broken = {get:async()=>{throw new Error('Storage outage');}};
  assert.equal((await denied(request,{FEED_SNAPSHOTS:broken})).status,502);
  const healthy = createHandler({...options,fetcher:async()=>new Response(xml)});
  assert.equal((await healthy(request,{FEED_SNAPSHOTS:{get:()=>assert.fail('unnecessary lookup')}})).status,200);
});
