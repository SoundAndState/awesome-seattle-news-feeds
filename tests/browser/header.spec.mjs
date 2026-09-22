import {test, expect, loadReader, waitForHeaderTransitions} from './fixtures.mjs';

const clickVisible = async (page, selector) => {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const logoHeight = page => page.locator('.brand-icon').evaluate(node => node.getBoundingClientRect().height);

test('the mobile header eases its logo and search row between sizes without hiding controls', async ({page}, testInfo) => {
  await page.setViewportSize({width:390, height:844});
  await loadReader(page);
  await page.evaluate(() => document.fonts.ready);
  const expanded = (await page.locator('#reader-header').boundingBox()).height;
  const samples = await page.evaluate(async () => {
    const header = document.querySelector('#reader-header'), logo = header.querySelector('.brand-icon');
    const values = [];
    scrollTo(0, 240);
    for (let frame = 0; frame < 30; frame++) {
      await new Promise(requestAnimationFrame);
      const views = header.querySelector('#library-views').getBoundingClientRect(), search = header.querySelector('#search-panel').getBoundingClientRect();
      values.push({height:header.getBoundingClientRect().height, logo:logo.getBoundingClientRect().height, overlap:search.left < views.right && search.top < views.bottom});
    }
    return values;
  });
  const compact = samples.at(-1).height;
  expect(compact).toBeLessThan(expanded - 50);
  expect(samples.some(sample => sample.logo > 31 && sample.logo < 43)).toBe(true);
  expect(new Set(samples.map(sample => Math.round(sample.height))).size).toBeGreaterThan(3);
  expect(samples.some(sample => sample.overlap)).toBe(false);
  const steps = samples.slice(1).map((sample, index) => Math.abs(sample.height - samples[index].height));
  expect(Math.max(...steps)).toBeLessThan((expanded - compact) * .65);
  for (const selector of ['.wordmark','#library-views','#search','#filter-button','#saved-button']) await expect(page.locator(selector)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (testInfo.project.name === 'webkit-mobile') await page.screenshot({path:testInfo.outputPath('header-compact.png')});
  await page.evaluate(() => scrollTo(0, 0));
  await expect.poll(() => logoHeight(page)).toBe(44);
  await expect.poll(async () => (await page.locator('#reader-header').boundingBox()).height).toBeCloseTo(expanded, 1);
  if (testInfo.project.name === 'webkit-mobile') await page.screenshot({path:testInfo.outputPath('header-expanded.png')});
  await page.setViewportSize({width:320, height:568});
  await page.evaluate(() => scrollTo(0, 240));
  await expect.poll(() => logoHeight(page)).toBe(30);
  await waitForHeaderTransitions(page);
  const search = await page.locator('#search-panel').boundingBox(), views = await page.locator('#library-views').boundingBox();
  expect(search.x).toBeGreaterThanOrEqual(views.x + views.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (testInfo.project.name === 'webkit-mobile') await page.screenshot({path:testInfo.outputPath('header-narrow.png')});
});

test('tab changes and history keep header size through restored positions and empty lists', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await loadReader(page);
  await page.evaluate(() => scrollTo(0, 1200));
  await expect.poll(() => logoHeight(page)).toBe(30);
  const header = page.locator('#reader-header');
  // Record any transient expansion, including one hidden by the final render.
  await page.evaluate(() => {
    window.headerExpanded = false;
    const header = document.querySelector('#reader-header');
    new MutationObserver(records => {
      if (records.some(record => !record.oldValue?.split(' ').includes('compact')) || !header.classList.contains('compact')) window.headerExpanded = true;
    }).observe(header, {attributes:true, attributeFilter:['class'], attributeOldValue:true});
  });
  await clickVisible(page, '[data-mode="posts"]');
  await expect(page.locator('.post')).not.toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  for (const view of ['unread','all']) {
    await clickVisible(page, `[data-view="${view}"]`);
    await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute('aria-pressed','true');
    await expect(header).toHaveClass(/compact/);
  }
  await clickVisible(page, '#saved-button');
  await expect(page.locator('.empty-state')).toContainText('You have not saved');
  await expect(header).toHaveClass(/compact/);
  await page.goBack();
  await expect(page.locator('.post')).not.toHaveCount(0);
  await page.goForward();
  await expect(page.locator('.empty-state')).toContainText('You have not saved');
  await clickVisible(page, '[data-mode="articles"]');
  await expect(page.locator('.article-card')).not.toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(1200);
  expect(await page.evaluate(() => window.headerExpanded)).toBe(false);
  expect(await logoHeight(page)).toBe(30);
  await clickVisible(page, '#back-to-top');
  await expect.poll(() => logoHeight(page)).toBe(44);
  await expect(header).not.toHaveClass(/compact/);
});

test('scrolling controls the header again after a tab switch and reduced motion avoids animation', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await loadReader(page);
  await page.evaluate(() => scrollTo(0, 600));
  await expect.poll(() => logoHeight(page)).toBe(30);
  await clickVisible(page, '[data-mode="posts"]');
  await expect(page.locator('.post')).not.toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('#reader-header')).toHaveClass(/compact/);
  await page.evaluate(() => new Promise(resolve => {
    window.addEventListener('scroll', () => requestAnimationFrame(resolve), {once:true});
    scrollTo(0, 40);
  }));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(40);
  expect(await logoHeight(page)).toBe(30);
  await page.evaluate(() => scrollTo(0, 0));
  await expect.poll(() => logoHeight(page)).toBe(44);
  await clickVisible(page, '[data-mode="articles"]');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(600);
  expect(await logoHeight(page)).toBe(44);
  await page.evaluate(() => scrollBy(0, 40));
  await expect.poll(() => logoHeight(page)).toBe(30);
  expect(await page.locator('#reader-header').evaluate(node => node.getAnimations({subtree:true}).filter(animation => animation instanceof CSSTransition).length)).toBe(0);
});
