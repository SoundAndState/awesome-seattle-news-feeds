import {test, expect} from '@playwright/test';
import catalog from '../../data/feeds.json' with {type: 'json'};
import site from '../../config/site.config.json' with {type: 'json'};
import {renderOpml} from '../../scripts/render.mjs';

const news = catalog.feeds.filter(feed => feed.category !== 'bluesky').slice(0, 3);
const posts = catalog.feeds.filter(feed => feed.category === 'bluesky').slice(0, 2);
const smallCatalog = {...catalog, feeds: [...news, ...posts]};
const fixture = id => `<rss version="2.0"><channel><title>Publisher</title><description>Local news</description><item><title>News from ${id}</title><description>Local reporting.</description><link>https://publisher.example/${id}</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;

async function prepare(page) {
  await page.route('**/catalog.json', route => route.fulfill({json: smallCatalog}));
  await page.route('**/feeds.opml', route => route.fulfill({contentType: 'application/xml', body: renderOpml(smallCatalog)}));
  const urls = new Set(smallCatalog.feeds.map(feed => new URL(feed.feed).href));
  await page.route(url => urls.has(url.href), route => route.abort('failed'));
  const requests = new Map();
  page.on('requestfailed', request => {
    const id = request.url().split('/').pop();
    if (requests.get(id)?.request() === request) requests.delete(id);
  });
  await page.route(`${site.proxy}/feed/*`, route => {requests.set(route.request().url().split('/').pop(), route);});
  const finish = async (feed, {fail = false} = {}) => {
    await expect.poll(() => requests.has(feed.id)).toBe(true);
    const route = requests.get(feed.id); requests.delete(feed.id);
    await route.fulfill({status: fail ? 502 : 200, contentType: fail ? 'application/json' : 'application/xml', body: fail ? '{"error":"Publisher unavailable"}' : fixture(feed.id)});
  };
  // Release intercepted requests after cancellation, including WebKit requests
  // that have not reached the network yet. The reader must ignore late responses.
  finish.release = async feeds => {
    for (const feed of feeds) {
      const route = requests.get(feed.id); requests.delete(feed.id);
      if (route) await route.fulfill({contentType: 'application/xml', body: fixture(feed.id)});
    }
  };
  return finish;
}

test('progress counts finished checks, including failures, and clears when the list is ready', async ({page}) => {
  const finish = await prepare(page);
  await page.goto('./');
  const bar = page.getByRole('progressbar', {name: 'Loading articles'});
  await expect(bar).toHaveAttribute('max', '3');
  await expect(bar).toHaveAttribute('value', '0');
  await expect(page.locator('#stories')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#loading-guidance')).toContainText('Wait to start reading');
  await expect(page.locator('#refresh')).toBeDisabled();
  const animation = await page.locator('.sk-flow').elementHandle();
  await finish(news[0]);
  await expect(bar).toHaveAttribute('value', '1');
  await expect(page.locator('.story')).toHaveCount(1);
  await finish(news[1], {fail: true});
  await expect(bar).toHaveAttribute('value', '2');
  await expect(page.locator('#loading-count')).toHaveText('2 of 3 feeds checked');
  expect(await animation.evaluate(node => node === document.querySelector('.sk-flow'))).toBe(true);
  await finish(news[2]);
  await expect(bar).toBeHidden();
  await expect(page.locator('#stories')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#stories')).not.toHaveAttribute('aria-describedby');
  await expect(page.locator('#announcement')).toContainText('Feed check complete');
  await expect(page.getByRole('button', {name: '1 unavailable', exact: true})).toBeVisible();
  await expect(page.locator('#refresh')).toBeEnabled();
  // Retrying a failed source starts a fresh count and leaves available stories accessible.
  await page.locator('#refresh').click();
  await expect(bar).toHaveAttribute('max', '1');
  await expect(bar).toHaveAttribute('value', '0');
  await expect(page.locator('.story')).toHaveCount(2);
  await finish(news[1]);
  await expect(bar).toBeHidden();
  await expect(page.locator('#new-items')).toContainText('1 new articles');
});

test('preparing the catalog has no invented percentage and an outage clears the indicator', async ({page}) => {
  let catalogRequest;
  await page.route('**/catalog.json', route => {catalogRequest = route;});
  await page.goto('./');
  const bar = page.getByRole('progressbar', {name: 'Preparing your reader'});
  await expect(bar).toBeVisible();
  await expect(bar).not.toHaveAttribute('value');
  await expect.poll(() => Boolean(catalogRequest)).toBe(true);
  await catalogRequest.abort('failed');
  await expect(bar).toBeHidden();
  await expect(page.locator('#stories')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#stories')).toContainText('reload the page');
});

test('mode changes, Saved, and going offline cancel the visible progress', async ({page}) => {
  const finish = await prepare(page);
  await page.goto('./');
  await expect(page.getByRole('progressbar')).toHaveAttribute('max', '3');
  await page.locator('[data-mode="posts"]').click();
  await finish.release(news);
  const bar = page.getByRole('progressbar', {name: 'Loading posts'});
  await expect(bar).toHaveAttribute('max', '2');
  await finish(posts[0]);
  await expect(bar).toHaveAttribute('value', '1');
  await page.locator('#saved-button').click();
  await finish.release(posts);
  await expect(page.locator('#feed-loading')).toBeHidden();
  await expect(page.locator('#stories')).toHaveAttribute('aria-busy', 'false');
  await page.locator('[data-mode="posts"]').click();
  await expect(bar).toHaveAttribute('max', '1');
  await page.context().setOffline(true);
  await finish.release(posts);
  await expect(page.locator('#feed-loading')).toBeHidden();
  await expect(page.locator('#stories')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#notice')).toContainText('offline');
  await page.context().setOffline(false);
  await expect(bar).toHaveAttribute('max', '1');
  await finish(posts[1]);
  await expect(bar).toBeHidden();
});

test('a filtered source uses its own total and a saved library needs no progress bar', async ({page}) => {
  const finish = await prepare(page);
  await page.goto(`./#source=${news[0].id}`);
  await expect(page.getByRole('progressbar')).toHaveAttribute('max', '1');
  await finish(news[0]);
  await expect(page.locator('#feed-loading')).toBeHidden();
  await page.locator('.save-button').click();
  await page.goto('./#view=saved');
  await expect(page.locator('.story')).toHaveCount(1);
  await expect(page.locator('#feed-loading')).toBeHidden();
  await expect(page.locator('#stories')).toHaveAttribute('aria-busy', 'false');
});

test('loading reflows on phones, tablets, desktop, landscape, and enlarged text', async ({page}, testInfo) => {
  const finish = await prepare(page);
  await page.goto('./');
  await finish(news[0]);
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '1');
  for (const size of [{width:320,height:568}, {width:390,height:844}, {width:768,height:1024}, {width:1024,height:768}, {width:1440,height:900}, {width:2560,height:1440}, {width:760,height:360}]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const panel = await page.locator('#feed-loading').boundingBox();
    const bar = await page.locator('#loading-bar').boundingBox();
    expect(bar.width).toBeGreaterThan(200);
    expect(bar.x).toBeGreaterThanOrEqual(panel.x);
    expect(bar.x + bar.width).toBeLessThanOrEqual(panel.x + panel.width);
    for (const id of ['loading-label', 'loading-count', 'loading-guidance']) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(panel.x);
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
      expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height);
    }
    if ([390,1440].includes(size.width)) await page.screenshot({path: testInfo.outputPath(`loading-${size.width}.png`)});
  }
  await page.setViewportSize({width:320,height:568});
  await page.route('**/loading-test.css', route => route.fulfill({contentType: 'text/css', body: '.feed-loading strong, #loading-count, #loading-guidance {font-size:28px} .feed-loading * {line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}'}));
  await page.addStyleTag({url: './loading-test.css'});
  await expect(page.locator('#loading-count')).toHaveCSS('font-size', '28px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('#feed-loading').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('loading-enlarged.png')});
});

test('reduced motion and forced colors preserve visible, accessible progress', async ({page}) => {
  const finish = await prepare(page);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('./');
  await finish(news[0]);
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '1');
  for (const dot of await page.locator('.sk-flow-dot').all()) await expect(dot).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await expect(page.locator('.sk-flow-dot').first()).toHaveCSS('animation-name', 'sk-flow');
  await page.emulateMedia({forcedColors: 'active'});
  if (await page.evaluate(() => matchMedia('(forced-colors: active)').matches)) {
    await expect(page.locator('.sk-flow-dot').first()).toHaveCSS('animation-name', 'none');
    await expect(page.locator('#loading-bar')).toHaveCSS('appearance', 'auto');
  }
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.locator('#loading-count')).toHaveText('1 of 3 feeds checked');
  const response = await page.request.get('./third-party-notices.txt');
  expect(await response.text()).toContain('SpinKit Flow (https://github.com/tobiasahlin/SpinKit)');
  expect(await response.text()).toContain('Copyright (c) 2020 Tobias Ahlin');
});
