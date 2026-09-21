import {test, expect, catalog, proxyRoute, loadReader, browserCatalog, mockCatalog, readStoredLibrary} from './fixtures.mjs';
import {defaultFeed, articleItem, rssFeed, NOW} from '../fixtures/feeds.mjs';
import {makeSource} from '../fixtures/catalog.mjs';

test('discarded old articles do not flash a new-articles notification while another feed is loading', async ({page}) => {
  const selected = browserCatalog({feeds: [makeSource(), makeSource({id: 'slow-news'})]});
  const items = Array.from({length: 195}, (_, i) => articleItem(`window-${i}`, {published: new Date(Date.parse(NOW) - i * 60000).toUTCString()}));
  let revision = 0, waiting;
  await mockCatalog(page, selected);
  await page.route(proxyRoute, route => {
    const id = route.request().url().split('/').pop();
    if (id === 'slow-news' && revision) {waiting = route; return;}
    const body = id === 'slow-news' ? defaultFeed(id) : rssFeed(revision ? items.slice(45) : items.slice(0, 150));
    return route.fulfill({contentType: 'application/xml', body});
  });
  await page.goto('./');
  await expect(page.locator('#loading-bar')).toHaveAccessibleName('Feed check complete');
  await expect(page.locator('#all-count')).toHaveText('151');
  for (let attempt = 0; attempt < 2; attempt++) {
    revision++;
    await page.clock.fastForward(16 * 60 * 1000);
    await expect(page.locator('#loading-count-value')).toHaveText('1 / 2');
    await expect(page.locator('#new-items')).toBeHidden();
    await expect.poll(() => Boolean(waiting)).toBe(true);
    await waiting.fulfill({contentType: 'application/xml', body: defaultFeed('slow-news')});
    waiting = undefined;
    await expect(page.locator('#loading-bar')).toHaveAccessibleName('Feed check complete');
    await expect(page.locator('#new-items')).toBeHidden();
    expect((await readStoredLibrary(page)).articles).toHaveLength(151);
  }
});

test('Unread keeps opened and manually read rows in place until the view or list is refreshed', async ({page}) => {
  await loadReader(page);
  await page.locator('[data-view="unread"]').click();
  await page.locator('#reading-options summary').click();
  await page.locator('#scroll-read').uncheck();
  await page.locator('#reading-options summary').click();
  const ids = await page.locator('.story').evaluateAll(cards => cards.map(card => card.dataset.article));
  const first = page.locator(`[data-article="${ids[0]}"]`);
  const second = page.locator(`[data-article="${ids[1]}"]`);
  const gap = await second.evaluate(node => node.getBoundingClientRect().top - document.querySelector('.story').getBoundingClientRect().top);
  await first.locator('.story-title').click();
  await page.getByRole('button', {name: 'Close story', exact: true}).click();
  await expect(first).toHaveClass(/is-read/);
  await expect(first.locator('.story-title')).toBeFocused();
  await second.locator('.read-button').focus();
  await page.keyboard.press('Enter');
  await expect(second).toHaveClass(/is-read/);
  await expect(second.locator('.read-button')).toBeFocused();
  expect(await page.locator('.story').evaluateAll(cards => cards.map(card => card.dataset.article))).toEqual(ids);
  expect(await second.evaluate(node => node.getBoundingClientRect().top - document.querySelector('.story').getBoundingClientRect().top)).toBeCloseTo(gap, 1);
  await page.locator('[data-view="unread"]').click();
  await expect(first).toHaveCount(0);
  await expect(second).toHaveCount(0);
  const next = page.locator('.story').first();
  const nextId = await next.getAttribute('data-article');
  await next.locator('.read-button').click();
  await expect(next).toHaveClass(/is-read/);
  await page.locator('#refresh').click();
  await expect(page.locator(`[data-article="${nextId}"]`)).toHaveCount(0);
});

test('scroll marking waits for the title to pass the header while the rest of the card remains visible', async ({page}) => {
  await loadReader(page);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[data-view="unread"]').click();
  const card = page.locator('.story').nth(3);
  await page.evaluate(() => scrollTo(0, 150));
  await expect(page.locator('#reader-header')).toHaveClass(/compact/);
  // Wait for native scroll events as well as animation frames: WebKit can
  // coalesce two programmatic scrolls before dispatching either event.
  await card.evaluate(node => new Promise(resolve => {
    window.addEventListener('scroll', () => requestAnimationFrame(() => requestAnimationFrame(resolve)), {once: true});
    scrollBy(0, node.querySelector('h2').getBoundingClientRect().bottom - document.querySelector('#reader-header').getBoundingClientRect().bottom - 8);
  }));
  await expect(card).not.toHaveClass(/is-read/);
  await page.evaluate(() => new Promise(resolve => {
    window.addEventListener('scroll', () => requestAnimationFrame(() => requestAnimationFrame(resolve)), {once: true});
    scrollBy(0, 12);
  }));
  await expect(card).toHaveClass(/is-read/);
  expect(await card.evaluate(node => node.getBoundingClientRect().bottom - document.querySelector('#reader-header').getBoundingClientRect().bottom)).toBeGreaterThan(100);
  await expect(card.locator('.read-button')).toBeInViewport();
});

test('header controls stay available, filters follow search, and showing new articles returns to the top', async ({page}, testInfo) => {
  let revision = 0;
  await page.route(proxyRoute, route => {
    const id = route.request().url().split('/').pop();
    const body = defaultFeed(id);
    return route.fulfill({contentType: 'application/xml', body: revision ? body.replaceAll(`https://publisher.example/${id}?`, `https://publisher.example/${id}-new?`) : body});
  });
  await page.goto('./');
  await expect(page.locator('#loading-bar')).toHaveAccessibleName('Feed check complete');
  await page.evaluate(() => scrollTo(0, 1200));
  revision++;
  await page.clock.fastForward(16 * 60 * 1000);
  const newsCount = catalog.feeds.filter(feed => feed.category !== 'bluesky').length;
  await expect(page.locator('#new-items')).toContainText(`${newsCount} new articles`);
  for (const selector of ['#search', '#filter-button', '#feed-loading', '#refresh', '#reading-options', '#new-items']) {
    await expect(page.locator(`#reader-header ${selector}`)).toBeInViewport();
  }
  const search = await page.locator('#search-panel').boundingBox(), filter = await page.locator('#filter-button').boundingBox();
  expect(filter.x).toBeGreaterThanOrEqual(search.x + search.width);
  expect(Math.abs(filter.y - search.y)).toBeLessThan(3);
  await page.screenshot({path: testInfo.outputPath('header-new-items.png')});
  const button = await page.locator('#new-items').boundingBox();
  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
  await expect(page.locator('#new-items')).toBeHidden();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('.story').first()).not.toHaveClass(/is-read/);
  await page.locator('#reading-options summary').click();
  await expect(page.locator('#mark-read')).toBeInViewport();
  const options = await page.locator('.options-content').boundingBox();
  expect(options.x).toBeGreaterThanOrEqual(0);
  expect(options.x + options.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('header-reading-options.png')});
});
