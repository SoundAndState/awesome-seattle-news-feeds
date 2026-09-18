import {normalizeFeed, verifyOpml} from './feeds.mjs';
import {normalizeCatalog, httpsUrl, feedServiceUrl} from './catalog.mjs';

export async function loadCatalog(site, {pageUrl, fetchImpl = fetch, timeout = 10000, signal} = {}) {
  const resolve = path => new URL(path, new URL(site.base || './', pageUrl)).href;
  const paths = [site.catalogUrl || 'catalog.json', ...(site.opmlUrl ? [site.opmlUrl] : [])];
  const deadline = AbortSignal.timeout(timeout);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  requestSignal.throwIfAborted();
  const responses = await Promise.all(paths.map(path => fetchImpl(resolve(path), {signal: requestSignal, credentials: 'omit', referrerPolicy: 'no-referrer'})));
  if (responses.some(response => !response.ok)) throw new Error('The reader could not download the feed list. Check your connection and reload the page.');
  const catalog = normalizeCatalog(await responses[0].json());
  const result = responses[1] ? verifyOpml(await responses[1].text(), catalog) : catalog;
  requestSignal.throwIfAborted();
  return result;
}

const MAX_BYTES = 5 * 1024 * 1024;
async function feedText(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('Feed exceeds the 5 MB limit.');
  }
  if (!response.body) throw new Error('The server returned an empty feed.');
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
  if (error instanceof TypeError) return direct ? 'Your browser could not load the feed directly. The publisher may block access from other websites (CORS), or a network problem may have interrupted the request.' : 'Your browser could not connect to the feed service.';
  return error.message.slice(0, 180);
}

export async function loadFeed(feed, proxy, {fetchImpl = fetch, timeout = 22000, signal} = {}) {
  // Validate even when called outside the catalog loader. Service routes always
  // carry one catalog ID, never a caller-controlled destination URL.
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feed.id)) throw new Error('The source has an invalid feed ID.');
  const publisherUrl = httpsUrl(feed.feed, 'feed address');
  const serviceUrl = proxy ? feedServiceUrl(proxy) : '';
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
  if (serviceUrl) {
    try {return await attempt(`${serviceUrl}/feed/${feed.id}`, false);}
    catch (error) {proxyFailure = failure(error, false);}
  }
  signal?.throwIfAborted();
  try {
    return await attempt(publisherUrl, true);
  } catch (error) {throw new Error(`${serviceUrl ? `Through the feed service: ${proxyFailure} ` : ''}Direct from the publisher: ${failure(error, true)}`);}
}
