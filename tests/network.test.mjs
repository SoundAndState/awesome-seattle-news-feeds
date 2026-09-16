import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFeed} from '../web/src/network.mjs';
import {articlesCsv} from '../web/src/export.mjs';

const feed = {id:'example', feed:'https://example.com/rss', website:'https://example.com'};
const proxy = 'https://proxy.example';
const xml = '<rss version="2.0"><channel><title>News</title><description>Local news</description><item><title>Local story</title><link>https://example.com/story</link></item></channel></rss>';

test('successful proxy requests never contact the publisher directly', async () => {
  const urls=[];
  const result=await loadFeed(feed,proxy,{fetchImpl:async url=>{urls.push(url);return new Response(xml);}});
  assert.deepEqual(urls,[`${proxy}/feed/example`]);
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
    assert.deepEqual(requests,[`${proxy}/feed/example`,feed.feed]);
    assert.equal(result.transport,'direct'); assert.equal(result.items[0].title,'Local story');
  }
});
test('both failure reasons survive, and oversized direct feeds are rejected', async () => {
  for (const [direct, reason] of [
    [() => {throw new TypeError('Failed to fetch');}, /CORS or network error/],
    [() => new Response('',{status:403}), /HTTP 403/],
    [() => new Response(xml,{headers:{'Content-Length':'6000000'}}), /5 MB limit/],
    [() => new Response('x'.repeat(5*1024*1024+1)), /5 MB limit/],
  ]) {
    let calls=0;
    await assert.rejects(loadFeed(feed,proxy,{fetchImpl:async()=>++calls===1?new Response('{"error":"Publisher blocked proxy."}',{status:502}):direct()}), error=>{
      assert.match(error.message,/Proxy: Publisher blocked proxy\. Direct:/); assert.match(error.message,reason); return true;
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
