import {test, expect, loadReader, readStoredLibrary} from './fixtures.mjs';

for (const mode of ['articles', 'posts']) test(`dismissing the ${mode} read confirmation preserves read marks and later Undo`, async ({page}, testInfo) => {
  await loadReader(page);
  if (mode === 'posts') {
    await page.locator('[data-mode="posts"]').click();
    await expect(page.locator('#refresh')).toBeEnabled();
    await page.getByRole('button', {name:'Dismiss feed status'}).click();
  }
  await page.locator('#reading-options summary').click();
  await page.locator('#scroll-read').uncheck();
  await page.locator('#reading-options summary').click();
  await page.locator('.save-button').first().click();
  await page.locator('[data-view="unread"]').click();
  const ids = await page.locator('.story').evaluateAll(nodes => nodes.map(node => node.dataset.article));
  await page.locator('#reading-options summary').click();
  await page.locator('#mark-read').click();
  await expect(page.locator('#undo-read')).toBeFocused();
  await expect(page.locator('#unread-count')).toHaveText('0');
  const stored = await readStoredLibrary(page);
  const close = page.getByRole('button', {name:'Dismiss read confirmation'});
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({width, height:844});
    await expect(close).toBeInViewport();
    await expect(page.locator('#undo-read')).toBeInViewport();
    const box = await close.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('#undo-bar').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    if (mode === 'articles' && ((testInfo.project.name === 'webkit-mobile' && width === 320) || (testInfo.project.name === 'chromium' && width === 1280))) {
      await page.screenshot({path:testInfo.outputPath(`read-confirmation-${width}.png`)});
    }
  }
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#undo-bar')).toBeHidden();
  await expect(page.locator('#heading')).toBeFocused();
  expect(await page.locator('.story').evaluateAll(nodes => nodes.map(node => node.dataset.article))).toEqual(ids);
  expect((await readStoredLibrary(page)).state).toEqual(stored.state);
  await page.reload();
  await expect(page.locator('#refresh')).toBeEnabled();
  await expect(page.locator('#unread-count')).toHaveText('0');
  await expect(page.locator('#saved-count')).toHaveText('1');
  await expect(page.locator('#undo-bar')).toBeHidden();

  await page.locator('[data-view="all"]').click();
  await page.locator('.read-button').first().click();
  await page.locator('#reading-options summary').click();
  await page.locator('#mark-read').click();
  await expect(page.locator('#undo-bar')).toBeVisible();
  await page.locator('#undo-read').click();
  await expect(page.locator('#unread-count')).toHaveText('1');
  await expect(page.locator('#undo-bar')).toBeHidden();
  await expect(page.locator('#saved-count')).toHaveText('1');
});
