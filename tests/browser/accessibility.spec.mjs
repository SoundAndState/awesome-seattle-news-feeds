import AxeBuilder from '@axe-core/playwright';
import {test, expect, browserCatalog, loadReader, openMenu} from './fixtures.mjs';

const catalog = browserCatalog({regionalCount: 1});
test.use({readerCatalog: catalog});

async function expectAccessible(page, label, testInfo) {
  await page.screenshot({path: testInfo.outputPath(`${label}.png`)});
  const results = await new AxeBuilder({page})
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  // Retain incomplete checks for human review; axe cannot establish conformance.
  await testInfo.attach(`accessibility-${label}`, {
    body: JSON.stringify({violations: results.violations, incomplete: results.incomplete}, null, 2),
    contentType: 'application/json',
  });
  expect(results.violations, `${label}: automatically detectable WCAG A/AA violations`).toEqual([]);
}

test('major reader views and dialogs pass the light desktop / dark phone accessibility smoke', async ({page}, testInfo) => {
  // The full behavior suite already spans five browser projects. Keep this
  // whole-page audit compact while exercising both themes and both layouts.
  test.skip(!['chromium', 'chromium-mobile'].includes(testInfo.project.name), 'Run the axe smoke on desktop and phone Chromium.');
  test.setTimeout(60000);
  const theme = testInfo.project.name === 'chromium-mobile' ? 'dark' : 'light';
  await loadReader(page, {catalog});
  await openMenu(page);
  await page.locator('#theme').selectOption(theme);
  if (await page.locator('#menu-toggle').isVisible()) await page.locator('#menu-toggle').click();
  await page.locator('[data-view="unread"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('.article-card').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expectAccessible(page, 'articles', testInfo);

  await page.locator('#filter-button').click();
  await expect(page.getByRole('dialog', {name: 'Filter articles'})).toBeVisible();
  await expectAccessible(page, 'filters', testInfo);
  await page.getByRole('button', {name: 'Close filters', exact: true}).click();

  const first = page.locator('.article-card').first();
  await first.locator('.save-button').click();
  await first.locator('.story-title').click();
  await expect(page.locator('#article-dialog')).toBeVisible();
  await expectAccessible(page, 'preview', testInfo);
  await page.getByRole('button', {name: 'Close story', exact: true}).click();
  await page.locator('#saved-button').click();
  await expect(page.locator('.article-card')).toHaveCount(1);
  await expectAccessible(page, 'saved', testInfo);

  await page.locator('[data-mode="posts"]').click();
  await expect(page.locator('.post')).toHaveCount(2);
  await expect(page.locator('#refresh')).toBeEnabled();
  await expectAccessible(page, 'posts', testInfo);
  await openMenu(page);
  await page.getByRole('button', {name: 'About this reader', exact: true}).click();
  await expect(page.locator('#about-dialog')).toBeVisible();
  for (const disclosure of await page.locator('#about-dialog summary').all()) await disclosure.click();
  await expectAccessible(page, 'about', testInfo);
});
