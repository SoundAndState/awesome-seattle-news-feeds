import {normalizeFeed, safeUrl} from './feeds.mjs';

const MAX_BYTES = 5 * 1024 * 1024;
async function feedText(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('Feed exceeds the 5 MB limit.');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {await reader.cancel(); throw new Error('Feed exceeds the 5 MB limit.');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  return new Blob(chunks).text();
}

function failure(error, direct) {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'Request timed out.';
  if (error instanceof TypeError) return direct ? 'Browser request failed (CORS or network error).' : 'Could not reach Cloudflare.';
  return error.message.slice(0, 180);
}

export async function loadFeed(feed, proxy, {fetchImpl = fetch, timeout = 22000, signal} = {}) {
  async function attempt(url, direct) {
    const deadline = AbortSignal.timeout(timeout);
    const response = await fetchImpl(url, {signal: signal ? AbortSignal.any([signal, deadline]) : deadline, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!response.ok) {
      const info = direct ? {} : await response.json().catch(() => ({}));
      throw new Error(typeof info.error === 'string' ? info.error : `HTTP ${response.status}.`);
    }
    const text = await feedText(response);
    try {return {
      items: normalizeFeed(text, feed),
      transport: direct ? 'direct' : response.headers.get('x-feed-transport') === 'snapshot' ? 'snapshot' : 'proxy',
      fetchedAt: direct ? 0 : Date.parse(response.headers.get('x-feed-fetched-at')) || 0,
      stale: !direct && response.headers.get('x-feed-stale') === 'true',
    };}
    catch (error) {throw new Error(`Invalid feed: ${error.message}`);}
  }
  let proxyFailure;
  try {return await attempt(`${proxy}/feed/${feed.id}`, false);}
  catch (error) {proxyFailure = failure(error, false);}
  signal?.throwIfAborted();
  try {
    const url = safeUrl(feed.feed);
    if (!url || new URL(url).protocol !== 'https:') throw new Error('A secure feed URL is required.');
    return await attempt(url, true);
  } catch (error) {throw new Error(`Proxy: ${proxyFailure} Direct: ${failure(error, true)}`);}
}
