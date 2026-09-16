import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler, cachePolicy, readLimited} from '../proxy/worker.mjs';

const xml = '<rss version="2.0"><channel><title>News</title></channel></rss>';
const env = {ALLOWED_ORIGINS: 'https://example.github.io', FEED_LIMITER: {limit: async () => ({success: true})}};
const feedMap = new Map([['news', {feed: 'https://publisher.example/rss', redirects: ['https://cdn.example/rss']}]]);
const request = (path = '/feed/news', options = {}) => new Request(`https://proxy.example${path}`, {headers: {Origin: 'https://example.github.io'}, ...options});

test('proxy rejects arbitrary targets, queries, writes, and disallowed origins before fetching', async () => {
  let fetched = 0;
  const handle = createHandler({feedMap, fetcher: async () => {fetched++; return new Response(xml);}});
  for (const [req, status] of [[request('/feed/unknown'),404], [request('/feed/news?url=http://localhost'),404], [request('/feed/news',{method:'POST'}),405], [request('/feed/news',{headers:{Origin:'https://evil.example'}}),403]]) assert.equal((await handle(req, env)).status,status);
  assert.equal(fetched,0);
  const preflight = await handle(request('/feed/news',{method:'OPTIONS',headers:{Origin:'https://example.github.io'}}),env); assert.equal(preflight.status,204); assert.equal(preflight.headers.get('access-control-allow-origin'),'https://example.github.io');
});
test('redirects are checked exactly and no visitor credentials reach publishers', async () => {
  let calls = 0;
  const handle = createHandler({feedMap, fetcher: async (url, options) => {
    assert.equal(options.redirect,'manual'); assert.equal(new Headers(options.headers).has('authorization'),false); assert.equal(new Headers(options.headers).has('cookie'),false);
    assert.match(new Headers(options.headers).get('user-agent'), /^Mozilla\/5\.0 \(compatible; SeattleNewsReader\//);
    calls++; return calls === 1 ? new Response(null,{status:302,headers:{Location:'https://cdn.example/rss'}}) : new Response(xml,{headers:{'Cache-Control':'public, max-age=120','Set-Cookie':'incidental=1'}});
  }});
  const response = await handle(request('/feed/news',{headers:{Origin:'https://example.github.io',Authorization:'private',Cookie:'private'}}),env);
  assert.equal(calls,2); assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'public, max-age=120'); assert.equal(response.headers.get('vary'),'Origin');
  assert.equal(response.headers.has('set-cookie'), false);
  for (const target of ['http://localhost/internal','https://cdn.example/other','https://evil.example/rss','https://www.youtube.com/@KING5Seattle']) {
    let attempts=0; const blocked=createHandler({feedMap,fetcher:async()=>{attempts++;return new Response(null,{status:302,headers:{Location:target}});}});
    const rejected=await blocked(request(),env);
    assert.equal(rejected.status,502); assert.equal(attempts,1);
    assert.ok((await rejected.json()).error.includes(new URL(target).hostname));
  }
});
test('publisher denials and explicit browser challenges have distinct, uncached explanations', async () => {
  for (const [headers,status,expected] of [[{'sg-captcha':'challenge'},202,/browser check/],[{'cf-mitigated':'challenge'},403,/browser check/],[{},403,/denied this feed service’s request \(HTTP 403\)/]]) {
    const response=await createHandler({feedMap,fetcher:async()=>new Response('<html>Blocked</html>',{status,headers})})(request(),env);
    assert.equal(response.status,502);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.match((await response.json()).error,expected);
  }
});
test('upstream refusals, challenge pages, oversized bodies, and rate limits stay uncached', async () => {
  for (const upstream of [new Response('',{status:202}),new Response('<html>challenge</html>'),new Response(xml,{headers:{'Content-Length':String(6*1024*1024)}})]) {
    const response=await createHandler({feedMap,fetcher:async()=>upstream})(request(),env); assert.equal(response.status,502); assert.equal(response.headers.get('cache-control'),'no-store');
  }
  await assert.rejects(readLimited(new Response('123456'),5),/too large/);
  const handle=createHandler({feedMap,fetcher:()=>assert.fail('must not fetch')});
  const limited=await handle(request(),{...env,FEED_LIMITER:{limit:async()=>({success:false})}}); assert.equal(limited.status,429); assert.equal(limited.headers.get('retry-after'),'60');
});
test('publisher privacy and freshness directives are respected', () => {
  for (const policy of ['private, max-age=1000','no-cache','no-store','max-age=0']) assert.equal(cachePolicy(new Headers({'Cache-Control':policy})),'no-store');
  assert.equal(cachePolicy(new Headers({'Set-Cookie':'session=1'})),'no-store');
  assert.equal(cachePolicy(new Headers({'Set-Cookie':'incidental=1', 'Cache-Control':'public, max-age=120'})), 'public, max-age=120');
  assert.equal(cachePolicy(new Headers({'Set-Cookie':'incidental=1', 'Cache-Control':'max-age=0, s-maxage=3600'})), 'public, max-age=900');
  assert.equal(cachePolicy(new Headers({'Cache-Control':'max-age=60','Age':'20'})),'public, max-age=40');
  assert.equal(cachePolicy(new Headers({'Cache-Control':'max-age=3600'})),'public, max-age=900');
});

test('cache freshness follows header precedence and subtracts age before the 15-minute cap', () => {
  const now = Date.UTC(2026, 8, 15, 12);
  const date = new Date(now).toUTCString();
  const policy = values => cachePolicy(new Headers(values), now);
  assert.equal(policy({'Cache-Control':'public, max-age=900', Expires:'Sun, 19 Nov 1978 05:00:00 GMT', Date:date}), 'public, max-age=900');
  assert.equal(policy({'Cache-Control':'max-age=0, s-maxage=300', Date:date}), 'public, max-age=300');
  assert.equal(policy({'Cache-Control':'max-age=3600', Age:'1200'}), 'public, max-age=900');
  assert.equal(policy({Date:date, Expires:new Date(now+120000).toUTCString(), Age:'20'}), 'public, max-age=100');
  assert.equal(policy({'Cache-Control':'max-age=120', Date:new Date(now-30000).toUTCString(), Age:'10'}), 'public, max-age=90');
  for (const value of ['max-age=-1','max-age=1.5','max-age=60, max-age=120']) assert.equal(policy({'Cache-Control':value}), 'no-store');
});

test('a stalled publisher times out without holding the request open', async () => {
  const handle = createHandler({feedMap, timeoutMs: 10, fetcher: async (_url, {signal}) => new Promise((_resolve, reject) => {signal.addEventListener('abort', () => reject(new Error('Aborted')));})});
  const response = await handle(request(), env);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /too long/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('timeouts also bound clients and response bodies that ignore cancellation', async () => {
  for (const fetcher of [async()=>new Promise(()=>{}), async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('<rss>'));}}))]) {
    const handle=createHandler({feedMap,timeoutMs:10,fetcher});
    const response=await handle(request(),env);
    assert.equal(response.status,502);
    assert.match((await response.json()).error,/too long/);
  }
});
