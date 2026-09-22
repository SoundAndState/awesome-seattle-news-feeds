import {test, expect, loadReader, waitForHeaderTransitions, catalog} from './fixtures.mjs';
import {articleItem, postItem, rssFeed} from '../fixtures/feeds.mjs';

const postFeed = catalog.feeds.find(source => source.category === 'bluesky');
const bodies = {[postFeed.id]:rssFeed(Array.from({length:12}, (_, index) => postItem(`scroll-${index}`)))};

for (const mode of ['articles', 'posts']) for (const view of ['all', 'unread']) test(`scroll marking ${mode} in ${view} never writes the scroll position`, async ({page}) => {
  await loadReader(page, {bodies});
  if (mode === 'posts') await page.locator('[data-mode="posts"]').click();
  await expect(page.locator('#refresh')).toBeEnabled();
  await page.locator(`[data-view="${view}"]`).click();
  await expect(page.locator('.story')).not.toHaveCount(0);
  await page.evaluate(() => scrollTo(0, 150));
  await waitForHeaderTransitions(page);
  await page.evaluate(() => {
    window.readScrollCalls = [];
    window.readerTestScroll = window.scrollTo.bind(window);
    for (const method of ['scrollTo', 'scrollBy']) {
      const original = window[method].bind(window);
      window[method] = (...args) => {window.readScrollCalls.push({method, args}); return original(...args);};
    }
  });
  const card = page.locator('.story').nth(2);
  await card.evaluate(node => new Promise(resolve => {
    window.addEventListener('scroll', () => requestAnimationFrame(() => requestAnimationFrame(resolve)), {once:true});
    window.readerTestScroll(0, scrollY + node.querySelector('h2, .post-text').getBoundingClientRect().bottom - document.querySelector('#reader-header').getBoundingClientRect().bottom - 8);
  }));
  await expect(card).not.toHaveClass(/is-read/);
  await page.evaluate(() => window.readerTestScroll(0, scrollY + 12));
  await expect(card).toHaveClass(/is-read/);
  expect(await page.evaluate(() => window.readScrollCalls)).toEqual([]);
});

for (const mode of ['articles', 'posts']) test(`searching ${mode} returns to the top without changing the view or losing focus`, async ({page}) => {
  await loadReader(page, {bodies});
  if (mode === 'posts') await page.locator('[data-mode="posts"]').click();
  await expect(page.locator('.story')).not.toHaveCount(0);
  for (const query of ['parks', 'trail']) {
    await page.evaluate(() => scrollTo(0, 700));
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
    await page.locator('#search').fill(query);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator('#search')).toBeFocused();
    await expect(page.locator(`[data-mode="${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-view="all"]')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.evaluate(() => scrollTo(0, 700));
  await page.locator('#search').press('Enter');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('#search')).toBeFocused();
  await page.evaluate(() => scrollTo(0, 700));
  await page.locator('#clear-search').click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('#search')).toBeFocused();
});

test('preview blockquotes have an inset rule, padded text, and room for nested quotations', async ({page}, testInfo) => {
  const feed = catalog.feeds.find(source => source.category !== 'bluesky');
  const html = '<p>Community members shared their plans.</p><blockquote><p>The trail will connect our neighborhoods and give everyone more room to walk.</p><blockquote><p>We look forward to the opening.</p></blockquote><p>The meeting continues next week.</p></blockquote><p>More reporting follows.</p>';
  await loadReader(page, {bodies:{[feed.id]:rssFeed([articleItem('quoted-story', {html})])}});
  await page.getByRole('button', {name:'Preview article: Seattle parks get a new trail — quoted-story'}).click();
  const quote = page.locator('.article-content > blockquote');
  for (const width of [390, 320, 1280]) {
    await page.setViewportSize({width, height:844});
    const spacing = await quote.evaluate(node => {
      const box = node.getBoundingClientRect(), text = node.querySelector('p').getBoundingClientRect();
      return {inset:box.left - node.parentElement.getBoundingClientRect().left, padding:text.left - box.left};
    });
    expect(spacing.inset).toBeGreaterThanOrEqual(12);
    expect(spacing.padding).toBeGreaterThanOrEqual(18);
    expect(await page.locator('#article-body').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(page.getByRole('button', {name:'Close story', exact:true})).toBeInViewport();
    if (width !== 320) await page.screenshot({path:testInfo.outputPath(`blockquote-${width}.png`)});
  }
});
