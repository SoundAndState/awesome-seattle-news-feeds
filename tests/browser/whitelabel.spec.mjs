import {test, expect, openMenu} from './fixtures.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {makeCatalog, makeSource} from '../fixtures/catalog.mjs';
import {jsonFeed, postsJson} from '../fixtures/json-feeds.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const sources = [
  makeSource({id: 'json-community', name: 'Community Journal', kind: 'posts', format: 'json-feed', feed: 'https://json.publisher.example/feed.json'}),
  makeSource({id: 'community-notices', name: 'Community Notices', kind: 'posts', format: 'posts-json', feed: 'https://posts.publisher.example/posts.json'}),
];
let directory, output;

test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-brand-browser-'));
  output = path.join(directory, 'site');
  const config = {
    name: 'Community Reader', title: 'Community Reader — neighborhood posts',
    description: 'Fictional community updates for browser tests.', tagline: 'neighborhood updates',
    url: 'https://community.example/', base: '/', storageNamespace: 'community-reader-test',
    theme: 'blue', proxy: '', catalog: './catalog.json', repository: '', opmlUrl: null,
    publicDir: path.join(repository, 'web/public'),
    capabilities: {articles: false, posts: true, archive: false, backups: false},
    about: {purpose: 'Discover updates from community organizations.'},
  };
  const configPath = path.join(directory, 'site.json');
  await fs.writeFile(configPath, JSON.stringify(config));
  await fs.writeFile(path.join(directory, 'catalog.json'), JSON.stringify(makeCatalog({feeds: sources})));
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'config/vite.config.mjs', '--outDir', output], {
    cwd: repository, env: {...process.env, READER_SITE_CONFIG: configPath}, encoding: 'utf8',
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
});

test.afterAll(async () => {if (directory) await fs.rm(directory, {recursive: true, force: true});});

test('an alternate build reads both JSON adapters and isolates its browser library and disclosures', async ({page, baseURL}) => {
  const requests = [];
  const origin = new URL(baseURL).origin;
  const bodies = new Map([
    [sources[0].feed, jsonFeed([{content_text: 'Community journal update.', id: 'journal-1'}])],
    [sources[1].feed, postsJson([{text: 'Community meeting notice.', id: 'notice-1'}])],
  ]);
  // Use the shared browser context, clock, and network guard, but serve this
  // temporary build on the fixture origin. No publisher or proxy is contacted.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (bodies.has(url.href)) {
      requests.push(url.href);
      return route.fulfill({contentType: 'application/json', body: bodies.get(url.href)});
    }
    if (url.origin !== origin) return route.fallback();
    const relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
    const filename = path.resolve(output, relative);
    if (!filename.startsWith(output + path.sep)) return route.abort('blockedbyclient');
    const contentType = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.opml': 'application/xml', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png'}[path.extname(filename)] || 'text/plain';
    return route.fulfill({path: filename, contentType});
  });
  await page.goto('./#view=all');
  await expect(page).toHaveTitle('Latest posts — Community Reader');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Community Reader — neighborhood posts');
  await expect(page.locator('.brand-name')).toHaveText('Community Reader');
  await expect(page.locator('.story')).toHaveCount(2);
  expect((await page.locator('.post-text').allTextContents()).sort()).toEqual(['Community journal update.', 'Community meeting notice.']);
  await expect(page.locator('[data-mode="articles"]')).toHaveCount(0);
  await expect(page.locator('.archive-link')).toHaveCount(0);
  await expect(page.locator('#feed-list-button')).toHaveCount(0);
  expect(requests.sort()).toEqual(sources.map(source => source.feed).sort());
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain('https://json.publisher.example');
  expect(csp).toContain('https://posts.publisher.example');
  expect(csp).not.toContain('workers.dev');
  await page.locator('.save-button').first().click();
  await expect(page.locator('#saved-count')).toHaveText('1');
  await page.reload();
  await expect(page.locator('#saved-count')).toHaveText('1');
  await page.locator('#saved-button').click();
  await expect(page.locator('.post')).toHaveCount(1);
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map(database => database.name));
  expect(databases).toEqual(['community-reader-test']);
  await openMenu(page);
  await page.locator('#about-button').click();
  const about = page.locator('#about-dialog');
  await expect(about).toContainText('Your browser requests feeds directly from their publishers.');
  await expect(about).not.toContainText(/Cloudflare|GitHub|KING 5|Ghostarchive/);
  await expect(page.locator('#export-state')).toHaveCount(0);
});
