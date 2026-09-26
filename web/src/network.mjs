import {messages, formatMessage} from './localization.mjs';
import {normalizeFeed} from './feeds.mjs';
import {verifyOpml} from './opml.mjs';
import {normalizeCatalog, httpsUrl, feedServiceUrl} from './catalog.mjs';

export async function loadCatalog(site, {pageUrl, fetchImpl = fetch, timeout = 10000, signal} = {}) {
  const resolve = path => new URL(path, new URL(site.base || './', pageUrl)).href;
  const paths = [site.catalogUrl || 'catalog.json', ...(site.opmlUrl ? [site.opmlUrl] : [])];
  const deadline = AbortSignal.timeout(timeout);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  requestSignal.throwIfAborted();
  const responses = await Promise.all(paths.map(path => fetchImpl(resolve(path), {signal: requestSignal, credentials: 'omit', referrerPolicy: 'no-referrer'})));
  if (responses.some(response => !response.ok)) throw new Error(messages.network.catalogFailed);
  const catalog = normalizeCatalog(await responses[0].json());
  const result = responses[1] ? verifyOpml(await responses[1].text(), catalog) : catalog;
  requestSignal.throwIfAborted();
  return result;
}

const MAX_BYTES = 5 * 1024 * 1024;
async function feedText(response, signal) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error(messages.network.tooLarge);
  }
  if (!response.body) throw new Error(messages.network.emptyFeed);
  const reader = response.body.getReader();
  const cancel = () => {reader.cancel(signal.reason).catch(() => {});};
  signal.addEventListener('abort', cancel, {once: true});
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {await reader.cancel(); throw new Error(messages.network.tooLarge);}
      chunks.push(value);
    }
    signal.throwIfAborted();
  } finally {signal.removeEventListener('abort', cancel); reader.releaseLock();}
  return new Blob(chunks).text();
}

async function untilAborted(signal, work) {
  signal.throwIfAborted();
  let abort;
  const canceled = new Promise((_, reject) => {abort = () => reject(signal.reason);});
  signal.addEventListener('abort', abort, {once: true});
  // Bound fetch and body reads even when a client or stream ignores abort.
  try {return await Promise.race([work(), canceled]);}
  finally {signal.removeEventListener('abort', abort);}
}

function failure(error, direct) {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return messages.network.timeout;
  if (error instanceof TypeError) return direct ? messages.network.directFailed : messages.network.serviceFailed;
  return error.message.slice(0, 180);
}

// Presentation copy can change without changing how the reader classifies a
// failure. The text fallback covers older stored errors and publisher messages.
export function feedFailureKind(error) {
  if (['refused', 'challenge', 'timeout', 'invalid-feed'].includes(error.code)) return error.code;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout';
  if (/403|denied/i.test(error.message)) return 'refused';
  if (/challenge|browser check/i.test(error.message)) return 'challenge';
  if (/timed out|too long|did not receive the feed in time/i.test(error.message)) return 'timeout';
  if (/Invalid feed|No stories|could not read the feed/i.test(error.message)) return 'invalid-feed';
  return '';
}

export async function loadFeed(feed, proxy, {fetchImpl = fetch, timeout = 15000, signal} = {}) {
  // Validate even when called outside the catalog loader. Service routes always
  // carry one catalog ID, never a caller-controlled destination URL.
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feed.id)) throw new Error(messages.network.invalidId);
  const publisherUrl = httpsUrl(feed.feed, messages.network.feedAddress);
  const serviceUrl = proxy ? feedServiceUrl(proxy) : '';
  signal?.throwIfAborted();
  const deadline = new AbortController();
  const timedOut = () => new DOMException(messages.network.requestTimeout, 'TimeoutError');
  const timer = setTimeout(() => deadline.abort(timedOut()), timeout);
  const requestSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  async function attempt(url, direct) {
    const serviceDeadline = new AbortController();
    // Reserve at least the final third of the total deadline for a direct retry.
    const serviceTimer = direct ? null : setTimeout(() => serviceDeadline.abort(timedOut()), timeout * 2 / 3);
    const attemptSignal = direct ? requestSignal : AbortSignal.any([requestSignal, serviceDeadline.signal]);
    try {return await untilAborted(attemptSignal, async () => {
      const response = await fetchImpl(url, {signal: attemptSignal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer'});
      if (attemptSignal.aborted) {response.body?.cancel().catch(() => {}); attemptSignal.throwIfAborted();}
      if (!response.ok) {
        const info = direct ? {} : await feedText(response, attemptSignal).then(JSON.parse).catch(() => ({}));
        if (direct) response.body?.cancel().catch(() => {});
        attemptSignal.throwIfAborted();
        throw Object.assign(new Error(typeof info.error === 'string' ? info.error : formatMessage(messages.network.httpError, {status: response.status})), {code: response.status === 403 ? 'refused' : ''});
      }
      const text = await feedText(response, attemptSignal);
      attemptSignal.throwIfAborted();
      try {return {
        items: normalizeFeed(text, feed),
        transport: direct ? 'direct' : response.headers.get('x-feed-transport') === 'snapshot' ? 'snapshot' : 'proxy',
        fetchedAt: direct ? 0 : Date.parse(response.headers.get('x-feed-fetched-at')) || 0,
        stale: !direct && response.headers.get('x-feed-stale') === 'true',
      };}
      catch (error) {throw Object.assign(new Error(formatMessage(messages.network.parseError, {message: error.message})), {code: 'invalid-feed'});}
    });} finally {clearTimeout(serviceTimer);}
  }
  try {
    let proxyFailure, proxyKind;
    if (serviceUrl) {
      try {return await attempt(`${serviceUrl}/feed/${feed.id}`, false);}
      catch (error) {proxyFailure = failure(error, false); proxyKind = feedFailureKind(error);}
    }
    signal?.throwIfAborted();
    try {return await attempt(publisherUrl, true);}
    catch (error) {
      signal?.throwIfAborted();
      const kinds = [proxyKind, feedFailureKind(error)];
      const code = ['refused', 'challenge', 'timeout', 'invalid-feed'].find(kind => kinds.includes(kind)) || '';
      throw Object.assign(new Error(formatMessage(messages.network.failureDetails, {service: serviceUrl ? formatMessage(messages.network.serviceDetail, {proxyFailure}) : '', direct: failure(error, true)})), {code});
    }
  } finally {clearTimeout(timer);}
}
