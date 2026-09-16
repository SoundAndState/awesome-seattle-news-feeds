import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import catalog from '../feeds.json' with {type: 'json'};
import {createHandler} from '../proxy/worker.mjs';
import {SNAPSHOT_FEEDS, snapshotLifetime} from '../proxy/snapshots.mjs';
import {normalizeFeed} from '../web/src/feeds.mjs';

// MyNorthwest accepts the audit's Python HTTP client but rejects Node's transport.
// Redirect authorization and feed validation still run through the shared handler.
export function pythonFetch(url, {headers, signal}) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.platform === 'win32' ? 'python' : 'python3', ['scripts/fetch-feed.py'], {
      signal, timeout: 22000, maxBuffer: 8 * 1024 * 1024,
      env: {PATH: process.env.PATH, ...(process.platform === 'win32' ? {SystemRoot: process.env.SystemRoot} : {})},
    }, (error, stdout) => {
      if (error) {reject(new Error('Publisher could not be reached by the feed collector.')); return;}
      try {
        const data = JSON.parse(stdout);
        if (data.error) throw new Error(data.error);
        resolve(new Response(Buffer.from(data.body, 'base64'), {status: data.status, headers: data.headers}));
      } catch {reject(new Error('Invalid response from the feed collector.'));}
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({url, headers}));
  });
}

export async function collectSnapshot(feed, {fetcher = fetch, now = Date.now} = {}) {
  let upstreamHeaders;
  const handle = createHandler({feedMap: new Map([[feed.id, feed]]), timeoutMs: 20000, fetcher: async (...args) => {
    const response = await fetcher(...args);
    upstreamHeaders = response.headers;
    return response;
  }});
  const response = await handle(new Request(`https://collector.invalid/feed/${feed.id}`), {});
  if (!response.ok) throw new Error((await response.json()).error);
  const fetchedAt = now();
  const lifetime = snapshotLifetime(upstreamHeaders, fetchedAt);
  if (!lifetime) throw new Error('Publisher does not permit caching this response.');
  const xml = await response.text();
  const items = normalizeFeed(xml, feed).length;
  return {url: feed.feed, xml, fetchedAt, ...lifetime, items};
}

async function main() {
  const {CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account} = process.env;
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const namespace = config.kv_namespaces?.find(binding => binding.binding === 'FEED_SNAPSHOTS')?.id;
  if (!token || !account || !namespace) throw new Error('Cloudflare credentials and FEED_SNAPSHOTS binding are required.');
  let failures = 0;
  for (const feed of catalog.feeds.filter(feed => SNAPSHOT_FEEDS.has(feed.id))) {
    try {
      const snapshot = await collectSnapshot(feed, {fetcher: feed.id === 'mynorthwest-local' ? pythonFetch : fetch});
      const expiration = Math.max(Math.ceil(snapshot.expiresAt / 1000), Math.ceil(Date.now() / 1000) + 60);
      const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace}/values/${feed.id}?expiration=${expiration}`;
      const response = await fetch(endpoint, {method: 'PUT', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(snapshot), signal: AbortSignal.timeout(30000)});
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(`Snapshot storage failed (HTTP ${response.status}).`);
      console.log(`${feed.id}: cached ${snapshot.items} items; collected ${new Date(snapshot.fetchedAt).toISOString()}.`);
    } catch (error) {
      // Keep the previous bounded snapshot on a temporary failure; it expires automatically.
      console.error(`${feed.id}: ${error.message}`);
      failures++;
    }
  }
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
