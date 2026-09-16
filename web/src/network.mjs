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
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'The reader did not receive the feed in time.';
  if (error instanceof TypeError) return direct ? 'Your browser could not load the feed directly. The publisher may block access from other websites (CORS), or a network problem may have interrupted the request.' : 'Your browser could not connect to Cloudflare.';
  return error.message.slice(0, 180);
}

export async function loadFeed(feed, proxy, {fetchImpl = fetch, timeout = 22000, signal} = {}) {
  async function attempt(url, direct) {
    const deadline = AbortSignal.timeout(timeout);
    const response = await fetchImpl(url, {signal: signal ? AbortSignal.any([signal, deadline]) : deadline, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!response.ok) {
      const info = direct ? {} : await response.json().catch(() => ({}));
      throw new Error(typeof info.error === 'string' ? info.error : `The server returned HTTP ${response.status}.`);
    }
    const text = await feedText(response);
    try {return {
      items: normalizeFeed(text, feed),
      transport: direct ? 'direct' : response.headers.get('x-feed-transport') === 'snapshot' ? 'snapshot' : 'proxy',
      fetchedAt: direct ? 0 : Date.parse(response.headers.get('x-feed-fetched-at')) || 0,
      stale: !direct && response.headers.get('x-feed-stale') === 'true',
    };}
    catch (error) {throw new Error(`The reader could not read the feed: ${error.message}`);}
  }
  let proxyFailure;
  try {return await attempt(`${proxy}/feed/${feed.id}`, false);}
  catch (error) {proxyFailure = failure(error, false);}
  signal?.throwIfAborted();
  try {
    const url = safeUrl(feed.feed);
    if (!url || new URL(url).protocol !== 'https:') throw new Error('The reader requires an HTTPS address to load a feed directly.');
    return await attempt(url, true);
  } catch (error) {throw new Error(`Through Cloudflare: ${proxyFailure} Direct from the publisher: ${failure(error, true)}`);}
}
