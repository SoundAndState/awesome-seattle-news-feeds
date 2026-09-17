import {test, expect, catalog, openMenu, loadReader, proxyFeedUrl} from './fixtures.mjs';
import {articleItem, rssFeed} from '../fixtures/feeds.mjs';

test('Unread and scroll marking are defaults; Latest and an opt-out survive reload and a fresh URL', async ({page}) => {
  await page.goto('./');
  await expect(page.locator('.story')).not.toHaveCount(0);
  await expect(page.locator('#refresh')).toBeEnabled();
  await expect(page.locator('[data-view="unread"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#scroll-read')).toBeChecked();
  await page.locator('[data-view="all"]').click();
  await page.locator('#reading-options summary').click();
  await page.locator('#scroll-read').uncheck();
  await expect(page.locator('#announcement')).toHaveText('The reader will wait for you to mark items read.');
  await page.reload();
  await expect(page.locator('[data-view="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#scroll-read')).not.toBeChecked();
  await page.goto('./');
  await expect(page.locator('[data-view="all"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-view="unread"]').click();
  await page.goto('./');
  await expect(page.locator('[data-view="unread"]')).toHaveAttribute('aria-pressed', 'true');
});

test('search clears without dropping source filters; all main controls remain visible while scrolling', async ({page}, testInfo) => {
  await loadReader(page);
  await page.locator('#search').fill('transit-news');
  await expect(page.locator('.story')).toHaveCount(1);
  await page.getByRole('button', {name:'Clear search'}).click();
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('#search')).toBeFocused();
  await expect(page.locator('.story')).toHaveCount(catalog.feeds.filter(feed => feed.category !== 'bluesky').length);
  await page.locator('#filter-button').click();
  await page.locator('[data-source="transit-news"]').click();
  await page.locator('#search').fill('no match');
  await page.getByRole('button', {name:'Clear search'}).click();
  await expect(page.locator('.story')).toHaveCount(1);
  await expect(page).toHaveURL(/source=transit-news/);
  await page.getByRole('button', {name:'Clear all', exact:true}).click();
  const initialLogo = await page.locator('.brand-icon').boundingBox();
  await page.evaluate(() => scrollTo(0, 1200));
  await expect(page.locator('#reader-header')).toHaveClass(/compact/);
  for (const selector of ['.wordmark','.brand-icon','#search','#saved-button','#library-views','[data-mode="articles"]','[data-mode="posts"]']) await expect(page.locator(selector)).toBeInViewport();
  if (testInfo.project.name.includes('mobile')) expect((await page.locator('.brand-icon').boundingBox()).height).toBeLessThan(initialLogo.height);
  await page.getByRole('button', {name:'Back to top'}).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('.wordmark')).toBeFocused();
});

test('publisher navigation and exclusions preserve Saved and can be managed across reloads', async ({page}) => {
  await loadReader(page);
  const card = page.locator('.story').first();
  const id = await card.getAttribute('data-article');
  await card.locator('.save-button').click();
  await card.locator('.story-title').click();
  await page.locator('#article-dialog .publisher').click();
  await expect(page.locator('#article-dialog')).toBeHidden();
  await expect(page.locator('.source-card')).toHaveCount(1);
  await page.getByRole('button', {name:'Exclude source', exact:true}).click();
  await page.locator('[data-mode="articles"]').click();
  await expect(page.locator('.source-card')).toHaveCount(0);
  await expect(page.locator(`[data-article="${id}"]`)).toHaveCount(0);
  await page.locator('#saved-button').click();
  await expect(page.locator(`[data-article="${id}"]`)).toBeVisible();
  await expect(page.locator('#library-views')).toBeVisible();
  await expect(page.locator('#export-saved')).toBeVisible();
  await page.reload();
  await expect(page.locator(`[data-article="${id}"]`)).toBeVisible();
  await openMenu(page);
  await page.locator('#excluded-button').click();
  await expect(page.locator('.source-card')).toHaveCount(1);
  await page.getByRole('button', {name:'Include source', exact:true}).click();
  await expect(page.locator('.source-card')).toHaveCount(0);
  await page.locator('[data-mode="articles"]').click();
  await expect(page.locator(`[data-article="${id}"]`)).toBeVisible();
  await expect(page.locator('#export-saved')).toBeHidden();
  await openMenu(page);
  await page.locator('#publications-button').click();
  await page.locator('[data-mode="articles"]').click();
  await expect(page.locator('.story')).not.toHaveCount(0);
  await page.locator('#saved-button').click();
  await page.locator('[data-mode="posts"]').click();
  await expect(page.locator('.post')).not.toHaveCount(0);
});

test('themes follow the device in Auto and persist an explicit choice; both lists and dialogs share surfaces', async ({page}, testInfo) => {
  await page.emulateMedia({colorScheme:'dark'});
  await loadReader(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  for (const choice of ['light','dark','auto']) {
    await openMenu(page);
    await page.locator('#theme').selectOption(choice);
    if (await page.locator('#menu-toggle').isVisible()) await page.locator('#menu-toggle').click();
    await page.locator('#search').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', choice === 'auto' ? 'dark' : choice);
    await expect(page.locator('html')).toHaveCSS('color-scheme', choice === 'auto' ? 'dark' : choice);
    const ratios = await page.locator('.story').first().evaluate(card => {
      const luminance = color => {
        const [r,g,b] = color.match(/[\d.]+/g).slice(0,3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return .2126*r + .7152*g + .0722*b;
      };
      return [...card.querySelectorAll('.headline-text,.excerpt,.publisher,.story-dates,.save-button,.read-button')].map(node => {
        let surface = node;
        while (getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement;
        const text = luminance(getComputedStyle(node).color), background = luminance(getComputedStyle(surface).backgroundColor);
        return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
      });
    });
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
    await page.locator('.story-title').first().click();
    await expect(page.locator('#article-title')).toHaveCSS('outline-style', 'none');
    await expect(page.locator('#article-dialog .close-button')).toBeInViewport();
    if (testInfo.project.name === 'chromium' || testInfo.project.name === 'webkit-mobile') await page.screenshot({path:testInfo.outputPath(`preview-${choice}.png`)});
    await page.goBack();
    await expect(page.locator('#article-dialog')).toBeHidden();
    if (testInfo.project.name === 'chromium' || testInfo.project.name === 'webkit-mobile') await page.screenshot({path:testInfo.outputPath(`feed-${choice}.png`)});
  }
  await openMenu(page);
  await page.locator('#theme').selectOption('light');
  await expect(page.locator('#announcement')).toContainText('Light theme');
  await page.reload();
  await expect(page.locator('.story').first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await openMenu(page);
  await page.locator('#theme').selectOption('auto');
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('feed authors appear in list and preview bylines and the read dot stays beside dates in both modes', async ({page}) => {
  await page.route(proxyFeedUrl('transit-news'), route => route.fulfill({contentType:'application/xml',body:rssFeed([articleItem('transit-news',{extraXml:'<dc:creator>Alex Reporter</dc:creator>'})])}));
  await page.goto('./#view=all&source=transit-news');
  await expect(page.locator('.story .author')).toHaveText('By Alex Reporter');
  await expect(page.locator('.date-line .unread-dot')).toHaveCount(1);
  await page.locator('.story-title').click();
  await expect(page.locator('#article-dialog .author')).toHaveText('By Alex Reporter');
  await page.goBack();
  await expect(page.locator('.story .read-dot')).toHaveAttribute('aria-label', 'Read');
  await page.locator('[data-mode="posts"]').click();
  await expect(page.locator('.post .date-line .unread-dot')).toHaveCount(2);
});

test('the mobile menu closes with Escape and compact-header filters restore focus; keyboard focus stays visible', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await loadReader(page);
  await openMenu(page);
  await expect(page.locator('#theme')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#resource-menu')).toBeHidden();
  await page.evaluate(() => scrollTo(0, 1000));
  await expect(page.locator('#reader-header')).toHaveClass(/compact/);
  await openMenu(page);
  await page.locator('#menu-filter-button').click();
  await expect(page.locator('#filter-dialog')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#filter-dialog')).toBeHidden();
  await expect(page.locator('#menu-toggle')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await page.locator('#saved-button').focus();
  await expect(page.locator('#saved-button')).toHaveCSS('outline-style', 'solid');
  await page.locator('[data-view="unread"]').click();
  await page.locator('.wordmark').click();
  await expect(page.locator('[data-view="unread"]')).toHaveAttribute('aria-pressed', 'true');
});

test('unavailable browser storage leaves themes, exclusions, and Saved usable for the current visit', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', {get() {throw new DOMException('Storage unavailable', 'SecurityError');}}));
  await loadReader(page);
  await expect(page.locator('#notice')).toContainText('cannot save changes in this browser');
  await openMenu(page);
  await page.locator('#theme').selectOption('dark');
  if (await page.locator('#menu-toggle').isVisible()) await page.locator('#menu-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.save-button').first().click();
  await page.locator('.publisher').first().click();
  await page.getByRole('button', {name:'Exclude source',exact:true}).click();
  await page.locator('#saved-button').click();
  await expect(page.locator('.story')).toHaveCount(1);
  await openMenu(page);
  await expect(page.locator('#excluded-count')).toHaveText('1');
});
