import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCatalog, loadFeed} from '../web/src/network.mjs';
import {articlesCsv} from '../web/src/export.mjs';
import {makeCatalog, makeSource} from './fixtures/catalog.mjs';
import {renderOpml} from '../scripts/render.mjs';
import {rss as xml} from './fixtures/feeds.mjs';

const feed = makeSource();
const proxy = 'https://proxy.example';

test('catalog delivery resolves the configured base and verifies OPML without credentials or referrers', async () => {
  const catalog = makeCatalog(), requests = [];
  const result = await loadCatalog({base: '/community/', opmlUrl: 'feeds.opml'}, {pageUrl: 'https://reader.example/community/#view=saved', fetchImpl: async (url, options) => {
    requests.push(url);
    assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(url.endsWith('.json') ? JSON.stringify(catalog) : renderOpml(catalog));
  }});
  assert.deepEqual(requests, ['https://reader.example/community/catalog.json', 'https://reader.example/community/feeds.opml']);
  assert.equal(result.feeds.length, catalog.feeds.length);
});

test('catalogs without OPML make one request and invalid or mismatched catalogs reject', async () => {
  const catalog = makeCatalog(); let calls = 0;
  const result = await loadCatalog({base: '/', opmlUrl: null}, {pageUrl: 'https://reader.example/', fetchImpl: async () => {calls++; return Response.json(catalog);}});
  assert.equal(calls, 1); assert.equal(result.feeds.length, catalog.feeds.length);
  for (const response of [() => new Response('', {status: 503}), () => Response.json({feeds: 'invalid'})]) {
    await assert.rejects(loadCatalog({base: '/'}, {pageUrl: 'https://reader.example/', fetchImpl: async () => response()}));
  }
  await assert.rejects(loadCatalog({base: '/', opmlUrl: 'feeds.opml'}, {pageUrl: 'https://reader.example/', fetchImpl: async url => new Response(url.endsWith('.json') ? JSON.stringify(catalog) : renderOpml(makeCatalog({feeds: [feed]})))}), /do not match/);
});

test('catalog cancellation aborts all requests and rejects late responses', async () => {
  const controller = new AbortController(), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const signals = [], catalog = makeCatalog();
  const loading = loadCatalog({base: '/', opmlUrl: 'feeds.opml'}, {pageUrl: 'https://reader.example/', signal: controller.signal, fetchImpl: async (url, {signal}) => {
    signals.push(signal); if (signals.length === 2) entered.resolve();
    await release.promise;
    return new Response(url.endsWith('.json') ? JSON.stringify(catalog) : renderOpml(catalog));
  }});
  await entered.promise;
  controller.abort();
  assert.ok(signals.every(signal => signal.aborted));
  release.resolve();
  await assert.rejects(loading, {name: 'AbortError'});
  await assert.rejects(loadCatalog({base: '/'}, {pageUrl: 'https://reader.example/', signal: controller.signal, fetchImpl: () => assert.fail('Canceled request started')}), {name: 'AbortError'});
});

test('successful proxy requests never contact the publisher directly', async () => {
  const urls=[];
  const result=await loadFeed(feed,proxy,{fetchImpl:async url=>{urls.push(url);return new Response(xml);}});
  assert.deepEqual(urls,[`${proxy}/feed/${feed.id}`]);
  assert.equal(result.transport,'proxy'); assert.equal(result.items.length,1);
});

test('a shared fallback reports its original collection time without a redundant browser fetch', async () => {
  let requests=0;
  const timestamp='2026-09-15T12:00:00.000Z';
  const result=await loadFeed(feed,proxy,{fetchImpl:async()=>{requests++;return new Response(xml,{headers:{'X-Feed-Transport':'snapshot','X-Feed-Fetched-At':timestamp,'X-Feed-Stale':'true'}});}});
  assert.equal(requests,1); assert.equal(result.transport,'snapshot'); assert.equal(result.stale,true); assert.equal(result.fetchedAt,Date.parse(timestamp));
});
test('proxy refusals, invalid feed bodies, and timeouts retry directly without credentials or referrer', async () => {
  for (const response of [() => new Response(JSON.stringify({error:'Publisher denied proxy request.'}),{status:502}), () => new Response('<html>Challenge</html>'), () => {throw new DOMException('Timed out','TimeoutError');}]) {
    const requests=[];
    const result=await loadFeed(feed,proxy,{fetchImpl:async (url,options)=>{
      requests.push(url);
      assert.equal(options.credentials,'omit'); assert.equal(options.referrerPolicy,'no-referrer'); assert.equal(options.mode,'cors'); assert.ok(options.signal instanceof AbortSignal);
      return requests.length === 1 ? response() : new Response(xml);
    }});
    assert.deepEqual(requests,[`${proxy}/feed/${feed.id}`,feed.feed]);
    assert.equal(result.transport,'direct'); assert.equal(result.items[0].title,'Local story');
  }
});
test('both failure reasons survive, and oversized direct feeds are rejected', async () => {
  for (const [direct, reason] of [
    [() => {throw new TypeError('Failed to fetch');}, /publisher may block access from other websites \(CORS\), or a network problem/],
    [() => new Response('',{status:403}), /HTTP 403/],
    [() => new Response(xml,{headers:{'Content-Length':'6000000'}}), /5 MB limit/],
    [() => new Response('x'.repeat(5*1024*1024+1)), /5 MB limit/],
  ]) {
    let calls=0;
    await assert.rejects(loadFeed(feed,proxy,{fetchImpl:async()=>++calls===1?new Response('{"error":"Publisher blocked proxy."}',{status:502}):direct()}), error=>{
      assert.match(error.message,/Through the feed service: Publisher blocked proxy\. Direct from the publisher:/); assert.match(error.message,reason); return true;
    });
    assert.equal(calls,2);
  }
});
test('CSV preserves Unicode, quotes, commas and lines while neutralizing spreadsheet formulas', () => {
  const csv=articlesCsv([{title:'Seattle, "news" — café',source:'=FORMULA()',published:0,url:'https://example.com/story',content:'Line one\nLine two',read:true},{title:'  @command',source:'Normal',published:Date.UTC(2026,8,15),url:'',content:'\tcommand',read:false}]);
  assert.ok(csv.startsWith('\uFEFF"Title","Source","Published","URL","Content","Read","Updated"\r\n'));
  assert.ok(csv.includes('"Seattle, ""news"" — café","\'=FORMULA()",""'));
  assert.ok(csv.includes('"Line one\nLine two","Yes",""\r\n'));
  assert.ok(csv.includes('"\'  @command","Normal","2026-09-15T00:00:00.000Z"'));
  assert.ok(csv.includes('"\'\tcommand","No",""\r\n'));
});


test('canceling an inactive mode stops fetching without a direct publisher retry', async () => {
  const controller=new AbortController(); let calls=0;
  await assert.rejects(loadFeed(feed,proxy,{signal:controller.signal,fetchImpl:async(_url,options)=>{
    calls++; controller.abort(); options.signal.throwIfAborted();
  }}),{name:'AbortError'});
  assert.equal(calls,1);
});

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('the 15-second feed deadline includes the service attempt and direct retry', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const requests = [];
  const checked = assert.rejects(loadFeed(feed, proxy, {fetchImpl: (url, {signal}) => {
    requests.push({url, signal});
    return new Promise(() => {});
  }}), /Through the feed service: .*in time\. Direct from the publisher: .*in time\./);
  await nextTurn();
  t.mock.timers.tick(9999); await nextTurn();
  assert.equal(requests.length, 1); assert.equal(requests[0].signal.aborted, false);
  t.mock.timers.tick(1); await nextTurn();
  assert.equal(requests.length, 2); assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].url, feed.feed);
  t.mock.timers.tick(4999); await nextTurn();
  assert.equal(requests[1].signal.aborted, false);
  t.mock.timers.tick(1);
  await checked;
  assert.equal(requests[1].signal.aborted, true);
});

test('stalled feed and error bodies are canceled before the direct retry', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for (const status of [200, 502]) {
    let requests = 0, canceled = false;
    const checked = loadFeed(feed, proxy, {fetchImpl: async () => {
      if (++requests === 2) return new Response(xml);
      return new Response(new ReadableStream({
        start(controller) {controller.enqueue(new TextEncoder().encode(status === 200 ? '<rss>' : '{'));},
        cancel() {canceled = true; return new Promise(() => {});},
      }), {status});
    }});
    await nextTurn();
    t.mock.timers.tick(10000);
    const result = await checked;
    assert.equal(requests, 2); assert.equal(canceled, true);
    assert.equal(result.transport, 'direct'); assert.equal(result.items.length, 1);
  }
});

test('a direct-only feed also stops waiting for a stalled body at the total deadline', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let canceled = false;
  const checked = assert.rejects(loadFeed(feed, '', {fetchImpl: async () => new Response(new ReadableStream({
    start(controller) {controller.enqueue(new TextEncoder().encode('<rss>'));},
    cancel() {canceled = true; return new Promise(() => {});},
  }))}), /Direct from the publisher: .*in time/);
  await nextTurn();
  t.mock.timers.tick(15000);
  await checked;
  assert.equal(canceled, true);
});

test('caller cancellation settles an uncooperative fetch and discards its late response', async () => {
  const controller = new AbortController(), response = Promise.withResolvers();
  let calls = 0, canceled = false;
  const checked = assert.rejects(loadFeed(feed, proxy, {signal:controller.signal, fetchImpl: () => {calls++; return response.promise;}}), {name:'AbortError'});
  controller.abort();
  await checked;
  response.resolve(new Response(new ReadableStream({cancel() {canceled = true;}})));
  await nextTurn();
  assert.equal(calls, 1); assert.equal(canceled, true);
  await assert.rejects(loadFeed(feed, proxy, {signal:controller.signal, fetchImpl: () => assert.fail('Canceled request started')}), {name:'AbortError'});
});
