import catalog from '../data/feeds.json' with {type: 'json'};
import {cachePolicy} from './cache.mjs';
import {snapshotResponse} from './snapshots.mjs';
export {cachePolicy} from './cache.mjs';

const feeds = new Map(catalog.feeds.map(feed => [feed.id, feed]));
const MAX_BYTES = 5 * 1024 * 1024;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = 'Mozilla/5.0 (compatible; SeattleNewsReader/1.0; +https://github.com/sayhiben/awesome-seattle-news-feeds)';

export async function readLimited(response, maxBytes = MAX_BYTES) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Feed is too large.');
  }
  if (!response.body) throw new Error('Publisher returned an empty response.');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Feed is too large.');
      parts.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

export function createHandler({feedMap = feeds, fetcher = fetch, timeoutMs = 15000} = {}) {
  return async (request, env) => {
    const origin = request.headers.get('origin');
    const allowed = new Set((env.ALLOWED_ORIGINS || '').split(','));
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    const errorResponse = (message, status) => Response.json({error: message}, {status, headers});
    if (origin && !allowed.has(origin)) return errorResponse('This feed service does not accept requests from this website.', 403);
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'Retry-After, X-Feed-Fetched-At, X-Feed-Transport, X-Feed-Stale, CF-Cache-Status');
    const url = new URL(request.url);
    const match = /^\/feed\/([a-z0-9-]+)$/.exec(url.pathname);
    const feed = match && feedMap.get(match[1]);
    if (!feed || url.search) return errorResponse('This feed service does not recognize that feed address.', 404);
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      headers.set('Access-Control-Max-Age', '86400');
      return new Response(null, {status: 204, headers});
    }
    if (request.method !== 'GET') {
      headers.set('Allow', 'GET, OPTIONS');
      return errorResponse('This feed service accepts only GET requests to load feeds.', 405);
    }
    // No public client secret exists. This generous per-IP limit tolerates shared networks;
    // exact destinations and bounded work are the primary safeguards.
    if (env.FEED_LIMITER && !(await env.FEED_LIMITER.limit({key: request.headers.get('CF-Connecting-IP') || 'unknown'})).success) {
      headers.set('Retry-After', '60');
      return errorResponse('This feed service has received too many requests from your IP address. Wait a minute, then try again.', 429);
    }
    const unavailable = async message => {
      try {
        const snapshot = await snapshotResponse(feed, match[1], env.FEED_SNAPSHOTS, headers);
        if (snapshot) return snapshot;
      } catch { /* A storage outage must not hide the publisher's error or prevent a browser retry. */ }
      return errorResponse(message, 502);
    };
    const controller = new AbortController();
    let timer;
    const fetchLive = async () => {try {
      const destinations = new Set([feed.feed, ...(feed.redirects || [])].map(value => new URL(value).href));
      let destination = feed.feed;
      let upstream;
      for (let hop = 0; hop <= 3; hop++) {
        const parsed = new URL(destination);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !destinations.has(parsed.href)) {
          const target = parsed.hostname === 'www.youtube.com' ? `${parsed.origin}${parsed.pathname}` : parsed.hostname;
          throw new Error(`The publisher sent this feed request to ${target}. This feed service cannot follow that address because its feed list does not include it.`);
        }
        upstream = await fetcher(parsed.href, {
          redirect: 'manual', signal: controller.signal,
          headers: {'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1', 'User-Agent': USER_AGENT},
        });
        if (!REDIRECT_CODES.has(upstream.status)) break;
        await upstream.body?.cancel();
        const location = upstream.headers.get('location');
        if (!location || hop === 3) throw new Error('Publisher redirected too many times.');
        destination = new URL(location, destination).href;
      }
      if (upstream.headers.get('sg-captcha') === 'challenge' || upstream.headers.get('cf-mitigated') === 'challenge') {
        await upstream.body?.cancel();
        return await unavailable('The publisher requires a browser check that this feed service cannot complete.');
      }
      if (upstream.status !== 200) {
        await upstream.body?.cancel();
        return await unavailable(upstream.status === 403 ? 'The publisher denied this feed service’s request (HTTP 403).' : `The publisher returned HTTP ${upstream.status}.`);
      }
      const bytes = await readLimited(upstream);
      const head = new TextDecoder().decode(bytes.subarray(0, 16384));
      if (!bytes.length || !/<(?:rss\b|feed\b|(?:[\w-]+:)?RDF\b)/i.test(head) || /<!DOCTYPE|<!ENTITY/i.test(head)) return await unavailable('Publisher did not return a readable feed.');
      headers.set('Content-Type', 'application/xml; charset=utf-8');
      headers.set('Cache-Control', cachePolicy(upstream.headers));
      headers.set('X-Feed-Fetched-At', new Date().toISOString());
      return new Response(bytes, {headers});
    } catch (error) {
      return await unavailable(controller.signal.aborted ? 'The publisher took too long to respond.' : error.message === 'fetch failed' ? 'This feed service could not connect to the publisher.' : error.message);
    }};
    try {
      // Some upstream streams do not settle after abort. Bound the whole operation,
      // including reading the response body, so the browser can use its fallback.
      return await Promise.race([fetchLive(), new Promise(resolve => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(unavailable('The publisher took too long to respond.'));
        }, timeoutMs);
      })]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export default {fetch: createHandler()};
