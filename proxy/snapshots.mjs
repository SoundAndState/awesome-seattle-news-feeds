import {cacheSeconds} from './cache.mjs';

export const SNAPSHOT_FEEDS = new Set(['king-5-local', 'krem-2-local', 'mynorthwest-local']);
export const MAX_SNAPSHOT_AGE = 6 * 60 * 60 * 1000;

export function snapshotLifetime(headers, now = Date.now()) {
  const freshSeconds = cacheSeconds(headers, now);
  if (!freshSeconds) return null;
  const policy = headers.get('cache-control') || '';
  // Restrictive responses cannot be reused after their freshness window.
  const revalidate = /\b(must-revalidate|proxy-revalidate|s-maxage)\b/i.test(policy);
  return {freshUntil: now + freshSeconds * 1000, expiresAt: now + (revalidate ? freshSeconds * 1000 : MAX_SNAPSHOT_AGE)};
}

export async function snapshotResponse(feed, id, store, headers, now = Date.now()) {
  if (!store || !SNAPSHOT_FEEDS.has(id)) return null;
  const value = await store.get(id, {type: 'json', cacheTtl: 60});
  if (!value || value.url !== feed.feed || typeof value.xml !== 'string' || value.xml.length > 5 * 1024 * 1024 || !Number.isFinite(value.fetchedAt) || value.fetchedAt > now || !Number.isFinite(value.expiresAt) || !Number.isFinite(value.freshUntil) || value.freshUntil < value.fetchedAt || value.expiresAt <= now || now - value.fetchedAt >= MAX_SNAPSHOT_AGE) return null;
  if (!/<(?:rss\b|feed\b|(?:[\w-]+:)?RDF\b)/i.test(value.xml.slice(0, 16384)) || /<!DOCTYPE|<!ENTITY/i.test(value.xml)) return null;
  const remaining = Math.floor((Math.min(value.expiresAt, value.fetchedAt + MAX_SNAPSHOT_AGE) - now) / 1000);
  if (remaining < 1) return null;
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/xml; charset=utf-8');
  responseHeaders.set('X-Feed-Transport', 'snapshot');
  responseHeaders.set('X-Feed-Fetched-At', new Date(value.fetchedAt).toISOString());
  // Once stale, keep a short shared TTL; every response identifies the original fetch time.
  responseHeaders.set('X-Feed-Stale', String(now >= value.freshUntil));
  responseHeaders.set('Cache-Control', `public, max-age=${Math.min(60, remaining, now < value.freshUntil ? Math.max(1, Math.floor((value.freshUntil - now) / 1000)) : remaining)}`);
  return new Response(value.xml, {headers: responseHeaders});
}
