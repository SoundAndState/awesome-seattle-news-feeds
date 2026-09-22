import {test, expect, catalog, loadReader, openMenu} from './fixtures.mjs';
import {articleItem, rssFeed} from '../fixtures/feeds.mjs';

const html = '<p>Local reporting with enough detail to scroll through the preview.</p>'.repeat(40);
const bodies = Object.fromEntries(catalog.feeds.map(feed => [feed.id, rssFeed([articleItem(feed.id, {html})])]));

async function openPreview(page) {
  await page.setViewportSize({width:390, height:844});
  await loadReader(page, {bodies});
  const title = page.locator('.story-title').nth(8);
  await title.click();
  await expect(page.locator('#article-dialog')).toBeVisible();
  return title;
}

// Dispatch the touch sequence in all engines; native Android touch input has
// separate coverage below. Synthetic moves expose whether scrolling is allowed.
async function swipe(page, selector, moves, {end = true, cancel = false, fingers = 1} = {}) {
  return page.locator(selector).evaluate((node, {moves, end, cancel, fingers}) => {
    const box = node.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    const fire = (type, dx = 0, dy = 0) => {
      const event = new Event(type, {bubbles:true, cancelable:true});
      const touches = Array.from({length:fingers}, (_, index) => ({identifier:index, clientX:x + dx + index * 20, clientY:y + dy}));
      Object.defineProperty(event, 'touches', {value:type === 'touchend' || type === 'touchcancel' ? [] : touches});
      Object.defineProperty(event, 'changedTouches', {value:touches});
      return node.dispatchEvent(event);
    };
    fire('touchstart');
    const allowed = moves.map(([dx, dy]) => fire('touchmove', dx, dy));
    return {allowed, endAllowed:end ? fire(cancel ? 'touchcancel' : 'touchend', ...moves.at(-1)) : null};
  }, {moves, end, cancel, fingers});
}

async function releaseTouch(page, selector) {
  await page.locator(selector).evaluate(node => {
    const event = new Event('touchend', {bubbles:true, cancelable:true});
    Object.defineProperty(event, 'touches', {value:[]});
    Object.defineProperty(event, 'changedTouches', {value:[]});
    node.dispatchEvent(event);
  });
}

test('pulling the article down closes its preview and restores the feed position and focus', async ({page}, testInfo) => {
  const title = await openPreview(page), dialog = page.locator('#article-dialog');
  const y = await page.evaluate(() => scrollY), top = (await dialog.boundingBox()).y;
  const result = await swipe(page, '#article-body', [[0,40],[0,140]], {end:false});
  expect(result.allowed).toEqual([false,false]);
  expect((await dialog.boundingBox()).y).toBeCloseTo(top + 140, 1);
  if (testInfo.project.name === 'webkit-mobile') await page.screenshot({path:testInfo.outputPath('preview-pulled-down.png')});
  await releaseTouch(page, '#article-body');
  await expect(dialog).toBeHidden();
  await expect(title).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(y, 1);
  await page.goForward();
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('data-swipe');
  await expect(dialog).toHaveCSS('transform', 'none');
  await dialog.getByRole('button', {name:'Close story', exact:true}).click();
  await expect(dialog).toBeHidden();
});

test('the top bar can dismiss a preview while its article is scrolled', async ({page}) => {
  await openPreview(page);
  await page.locator('#article-body').evaluate(node => node.scrollTop = 350);
  const result = await swipe(page, '.article-dialog-actions', [[0,45],[0,140]]);
  expect(result.endAllowed).toBe(false);
  await expect(page.locator('#article-dialog')).toBeHidden();
});

test('reading, short drags, canceled touches, controls, and text selection do not dismiss the preview', async ({page}) => {
  await openPreview(page);
  const dialog = page.locator('#article-dialog'), body = page.locator('#article-body');
  await body.evaluate(node => node.scrollTop = 350);
  expect((await swipe(page, '#article-body', [[0,140]])).allowed).toEqual([true]);
  await body.evaluate(node => node.scrollTop = 0);
  expect((await swipe(page, '#article-body', [[0,-140]])).allowed).toEqual([true]);
  for (const [selector, moves, options] of [
    ['#article-body', [[0,35]], {}],
    ['#article-body', [[140,10]], {}],
    ['#article-body', [[0,140]], {cancel:true}],
    ['#article-body', [[0,140]], {fingers:2}],
    ['#article-save .save-button', [[0,140]], {}],
    ['#article-title a', [[0,140]], {}],
  ]) {
    await swipe(page, selector, moves, options);
    await expect(dialog).not.toHaveAttribute('data-swipe');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('transform', 'none');
  }
  await body.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node.querySelector('.article-content p'));
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await swipe(page, '#article-body', [[0,140]]);
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => getSelection().toString())).not.toBe('');
});

test('reduced motion keeps swipe dismissal available and other dialogs keep their close controls', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await openPreview(page);
  await swipe(page, '.article-dialog-actions', [[0,140]], {end:false});
  await expect(page.locator('#article-dialog')).toHaveCSS('transform', 'none');
  await releaseTouch(page, '.article-dialog-actions');
  await expect(page.locator('#article-dialog')).toBeHidden();
  await openMenu(page);
  await page.locator('#about-button').click();
  await swipe(page, '#about-dialog .dialog-top', [[0,140]]);
  await expect(page.locator('#about-dialog')).toBeVisible();
  await page.getByRole('button', {name:'Close about', exact:true}).click();
  await expect(page.locator('#about-dialog')).toBeHidden();
});

test('native touch input scrolls article text and then pulls down to dismiss at the top', async ({page, context, browserName}) => {
  test.skip(browserName !== 'chromium', 'Native touch injection uses Chromium; other engines exercise touch cancellation above.');
  await openPreview(page);
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', {enabled:true, maxTouchPoints:1});
  const body = page.locator('#article-body');
  const box = await body.boundingBox();
  const touch = async dy => {
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await client.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x,y}]});
    for (const part of [.25,.5,.75,1]) await client.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x,y:y + dy * part}]});
    await client.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  };
  await touch(-160);
  await expect.poll(() => body.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('#article-dialog')).toBeVisible();
  await body.evaluate(node => node.scrollTop = 0);
  await touch(160);
  await expect(page.locator('#article-dialog')).toBeHidden();
});
