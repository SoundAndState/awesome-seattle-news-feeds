import {test as base, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import site from '../../config/site.config.json' with {type: 'json'};
import {renderOpml} from '../../scripts/render.mjs';
import {makeCatalog} from '../fixtures/catalog.mjs';
import {defaultFeed, NOW} from '../fixtures/feeds.mjs';

export {expect};
export const proxyRoute = `${site.proxy}/feed/*`;
export const proxyFeedUrl = id => `${site.proxy}/feed/${id}`;
// Route fictional direct feeds through an origin the production CSP permits.
// Requests are intercepted; the fixture never contacts this service or changes CSP.
export function browserCatalog(options) {
  const catalog = makeCatalog(options);
  for (const feed of catalog.feeds) feed.feed = `${site.proxy}/__fixture_feeds__/${feed.id}.xml`;
  return catalog;
}
export const catalog = browserCatalog();
export async function mockCatalog(target, selected) {
  await target.route('**/catalog.json', route => route.fulfill({json: selected}));
  await target.route('**/feeds.opml', route => route.fulfill({contentType: 'application/xml', body: renderOpml(selected)}));
  const direct = new Set(selected.feeds.map(feed => feed.feed));
  await target.route(url => direct.has(url.href), route => route.abort('failed'));
}
export async function mockFeeds(target, {fail = false, bodies = {}} = {}) {
  await target.route(proxyRoute, route => {
    const id = route.request().url().split('/').pop();
    return route.fulfill({status: fail ? 502 : 200, contentType: fail ? 'application/json' : 'application/xml', body: fail ? JSON.stringify({error: 'Publisher returned HTTP 403.'}) : bodies[id] ?? defaultFeed(id)});
  });
}

export async function loadReader(page, {fail = false, catalog: selected = catalog, bodies = {}} = {}) {
  await mockCatalog(page, selected);
  await mockFeeds(page, {fail, bodies});
  // These scenarios inspect both read and unread items; defaults have separate coverage.
  await page.goto('./#view=all');
  // Fresh Firefox profiles can take longer to open IndexedDB on shared runners.
  await expect(page.locator('#feed-progress')).toContainText('The reader last checked feeds', {timeout:15000});
  await expect(page.locator('#refresh')).toBeEnabled();
  await expect(page.locator('#all-count')).toHaveText(fail ? '0' : String(selected.feeds.filter(feed => feed.category !== 'bluesky').length));
  await page.getByRole('button', {name: 'Dismiss feed status'}).click();
}

async function prepareContext(context, {baseURL, selected, published, bodies}) {
  const unexpected = [];
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.fallback();
    unexpected.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  if (!published) await mockCatalog(context, selected);
  const feeds = published ? JSON.parse(await readFile(new URL('../../data/feeds.json', import.meta.url))).feeds : selected.feeds;
  const direct = new Set(feeds.map(feed => feed.feed));
  await context.route(url => direct.has(url.href), route => route.abort('failed'));
  await mockFeeds(context, {bodies});
  return unexpected;
}

export const test = base.extend({
  readerCatalog: [catalog, {option: true}],
  publishedCatalog: [false, {option: true}],
  feedBodies: [{}, {option: true}],
  context: async ({context, baseURL, readerCatalog, publishedCatalog, feedBodies}, use) => {
    const unexpected = await prepareContext(context, {baseURL, selected: readerCatalog, published: publishedCatalog, bodies: feedBodies});
    await use(context);
    expect(unexpected, 'Mock external requests explicitly; browser tests must not contact live services.').toEqual([]);
  },
  page: async ({page}, use) => {
    await page.clock.install({time: NOW});
    await use(page);
  },
  newReaderPage: async ({browser, baseURL, readerCatalog, publishedCatalog, feedBodies}, use) => {
    const contexts = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({baseURL, ...options});
      const unexpected = await prepareContext(context, {baseURL, selected: readerCatalog, published: publishedCatalog, bodies: feedBodies});
      contexts.push({context, unexpected});
      const page = await context.newPage();
      await page.clock.install({time: NOW});
      return page;
    });
    for (const {context, unexpected} of contexts) {
      await context.close();
      expect(unexpected, 'Unexpected external request from a secondary reader').toEqual([]);
    }
  },
});

export async function openMenu(page) {
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const toggle = page.locator('#menu-toggle');
  // React may mount after DOMContentLoaded. Do not mistake an absent control
  // for the desktop layout, where the attached menu toggle is intentionally hidden.
  await expect(toggle).toBeAttached();
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await expect(page.locator('#resource-menu')).toBeVisible();
}

export async function expectResourceFocus(page, selector) {
  await expect(page.locator(await page.locator('#menu-toggle').isVisible() ? '#menu-toggle' : selector)).toBeFocused();
}
