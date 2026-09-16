import {test, expect, catalog, browserCatalog, proxyRoute} from './fixtures.mjs';
import {rssFeed, postItem, postUrl, postId} from '../fixtures/feeds.mjs';

const source = catalog.feeds.find(feed => feed.category === 'bluesky');
test.use({readerCatalog:browserCatalog({feeds:[source]})});
const shortText = 'A new trail connects two neighborhoods. Parks & trails <3';
const longText = `${'Neighbors are exploring the new waterfront paths and sharing ideas for safer crossings. '.repeat(7)}https://example.com/${'a-long-path-'.repeat(20)}`;
const fixture = rssFeed([
  postItem('short', {text:shortText}),
  postItem('long', {text:longText, published:'Tue, 15 Sep 2026 09:00:00 GMT'}),
  postItem('unsafe', {text:'A post without a usable source link.', url:'javascript:alert(1)', published:'Tue, 15 Sep 2026 08:00:00 GMT'}),
]);

async function load(page, hash = '#mode=posts') {
  await page.route(proxyRoute, route => route.fulfill({contentType:'application/xml', body:fixture}));
  await page.goto(`./${hash}`);
  await expect(page.locator('.post')).toHaveCount(3);
  await expect(page.locator('#refresh')).toBeEnabled();
}

test('post text opens its source by pointer and keyboard without preview or link styling', async ({page}) => {
  await load(page);
  const card = page.locator('.post').filter({hasText:shortText}), text = card.locator('.post-text');
  await expect(text).toHaveText(shortText);
  await expect(text).toHaveAttribute('href', postUrl('short'));
  await expect(text).toHaveAttribute('target', '_blank');
  await expect(text).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(text).toHaveCSS('font-weight', '400');
  await expect(text).toHaveCSS('text-decoration-line', 'none');
  await expect(text).toHaveCSS('cursor', 'pointer');
  const color = await text.evaluate(node => getComputedStyle(node).color);
  await text.hover();
  await expect(text).toHaveCSS('color', color);
  await expect(text).toHaveCSS('text-decoration-line', 'none');
  await expect(page.getByRole('button', {name:'Preview post'})).toHaveCount(0);

  const requests = [];
  await page.context().route(postUrl('short'), route => {
    requests.push(route.request());
    return route.fulfill({contentType:'text/html', body:'<h1>Original post</h1>'});
  });
  for (const keyboard of [false, true]) {
    if (keyboard) {
      await page.keyboard.press('Tab');
      await text.focus();
      await expect(text).toBeFocused();
      await expect(text).toHaveCSS('outline-style', 'solid');
    }
    const popupPromise = page.waitForEvent('popup');
    if (keyboard) await page.keyboard.press('Enter');
    else await text.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(postUrl('short'));
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    await expect(card.locator('.read-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#article-dialog')).toBeHidden();
    await expect(page).toHaveURL(/#mode=posts$/);
    if (!keyboard) await card.locator('.read-button').click();
  }
  expect(requests).toHaveLength(2);
  for (const request of requests) expect(request.headers().referer).toBeUndefined();
});

test('long post links expand and reflow in Posts and Saved while unusable links stay plain text', async ({page}, testInfo) => {
  await load(page);
  const card = page.locator('.post').filter({hasText:longText}), text = card.locator('.post-text');
  await expect(text).toHaveClass(/collapsed/);
  await card.getByRole('button', {name:'Show more', exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(text).not.toHaveClass(/collapsed/);
  await expect(text).toHaveText(longText);
  await expect(text).toHaveAttribute('href', postUrl('long'));
  await expect(card.getByRole('button', {name:'Show less', exact:true})).toBeFocused();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width, height:900});
    expect(await page.locator('html').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await text.evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    if (testInfo.project.name === 'chromium' && width !== 320) {
      await page.evaluate(() => {document.activeElement.blur(); scrollTo(0, 0);});
      await page.screenshot({path:testInfo.outputPath(`posts-${width}.png`), fullPage:true});
    }
  }
  const plain = page.locator('.post').filter({hasText:'A post without a usable source link.'});
  await expect(plain.locator('p.post-text')).toBeVisible();
  await expect(plain.locator('.post-text')).not.toHaveAttribute('href');
  await expect(plain.locator('.post-text')).toHaveCSS('cursor', 'auto');
  await card.locator('.save-button').click();
  await page.locator('#saved-button').click();
  await expect(page.locator('.post')).toHaveCount(1);
  await expect(text).toHaveAttribute('href', postUrl('long'));
  await expect(page.locator('.preview-post')).toHaveCount(0);
  await card.getByRole('button', {name:'Show less', exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(text).toHaveClass(/collapsed/);
  await expect(card.getByRole('button', {name:'Show more', exact:true})).toBeFocused();
});

test('old post preview URLs return to Posts or Saved without opening a preview', async ({page}) => {
  await load(page, `#mode=posts&article=${encodeURIComponent(postId('short'))}`);
  await expect(page).toHaveURL(/#mode=posts$/);
  await expect(page.locator('#article-dialog')).toBeHidden();
  const card = page.locator('.post').filter({hasText:shortText});
  await expect(card.locator('.read-button')).toHaveAttribute('aria-pressed', 'false');
  await card.locator('.save-button').click();
  await page.goto(`./#view=saved&article=${encodeURIComponent(postId('short'))}`);
  await expect(page).toHaveURL(/#mode=posts&view=saved&kind=posts$/);
  await expect(page.locator('#article-dialog')).toBeHidden();
  await expect(page.locator('.post')).toHaveCount(1);
  await expect(card.locator('.post-text')).toHaveAttribute('href', postUrl('short'));
});

test('read posts dim and show an inset bar without shifting text, including scroll marking and Saved', async ({page}, testInfo) => {
  await load(page);
  const card = page.locator('.post').filter({hasText:shortText}), text = card.locator('.post-text');
  const marker = () => card.locator('.story-copy').evaluate(node => {
    const style = getComputedStyle(node, '::before');
    return {content:style.content, width:style.borderInlineStartWidth, color:style.borderInlineStartColor, pointerEvents:style.pointerEvents};
  });
  const geometry = () => text.evaluate(node => {
    const text = node.getBoundingClientRect(), card = node.closest('.story').getBoundingClientRect();
    return {x:text.x - card.x, y:text.y - card.y, width:text.width, height:text.height, cardHeight:card.height};
  });
  const unreadColor = await text.evaluate(node => getComputedStyle(node).color);
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height:900});
    const before = await geometry();
    await card.locator('.read-button').click();
    await expect(card).toHaveClass(/is-read/);
    await expect(text).toHaveCSS('color', 'rgb(98, 98, 92)');
    expect(await marker()).toEqual({content:'""', width:'4px', color:'rgb(208, 208, 204)', pointerEvents:'none'});
    expect(await geometry()).toEqual(before);
    await expect(text).toHaveCSS('text-decoration-line', 'none');
    await expect(text).toHaveCSS('cursor', 'pointer');
    if (testInfo.project.name === 'chromium') await card.screenshot({path:testInfo.outputPath(`read-post-${width}.png`)});
    await card.locator('.read-button').click();
    await expect(card).not.toHaveClass(/is-read/);
    await expect(text).toHaveCSS('color', unreadColor);
    expect((await marker()).content).toBe('none');
    expect(await geometry()).toEqual(before);
  }
  await card.locator('.save-button').click();
  await page.setViewportSize({width:390, height:568});
  await page.locator('#reading-options summary').click();
  await page.locator('#scroll-read').check();
  await page.locator('#reading-options summary').click();
  await card.evaluate(node => scrollTo(0, scrollY + node.getBoundingClientRect().bottom + 2));
  await expect(card).toHaveClass(/is-read/);
  expect((await marker()).width).toBe('4px');
  await page.locator('#saved-button').click();
  await page.reload();
  await expect(card).toHaveClass(/is-read/);
  await expect(text).toHaveCSS('color', 'rgb(98, 98, 92)');
  expect((await marker()).width).toBe('4px');
  await page.emulateMedia({forcedColors:'active'});
  expect((await marker()).content).toBe('""');
  expect((await marker()).width).toBe('4px');
});
