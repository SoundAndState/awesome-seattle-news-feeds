import {test, expect} from './fixtures.mjs';
import {readFile} from 'node:fs/promises';
import site from '../../config/site.config.json' with {type:'json'};

// These checks verify shipped metadata and native downloads, which browser route
// mocks do not intercept consistently. Publisher responses remain fixtures.
test.use({publishedCatalog:true});

test('sharing metadata and its image are available without JavaScript',async({newReaderPage})=>{
  const page=await newReaderPage({javaScriptEnabled:false});const context=page.context();
  try {
    await page.goto('./');
    await expect(page).toHaveTitle(site.title);
    await expect(page.locator('title')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href',site.url);
    for(const selector of ['meta[name="description"]','meta[property="og:description"]','meta[name="twitter:description"]'])await expect(page.locator(selector)).toHaveAttribute('content',site.description);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content',site.title);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content','website');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content',site.url);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content','summary_large_image');
    const image=new URL(await page.locator('meta[property="og:image"]').getAttribute('content'));
    expect(image.origin).toBe(new URL(site.url).origin);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content',image.href);
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute('content',/Sound & State/);
    const response=await page.request.get(image.pathname);expect(response.ok()).toBe(true);expect(response.headers()['content-type']).toContain('image/png');
    const png=await response.body();expect(png.subarray(1,4).toString()).toBe('PNG');expect(png.readUInt32BE(16)).toBe(1200);expect(png.readUInt32BE(20)).toBe(630);
  } finally {await context.close();}
});

test('feed list guide requires an explicit download and keeps import help available',async({page,context})=>{
  // Browser-managed downloads do not use page routes consistently across engines.
  await page.goto('./#view=saved');await expect(page.locator('#result-label')).toHaveText('0 saved items · Newest first');const downloads=[];page.on('download',download=>downloads.push(download));
  const trigger=page.locator('#feed-list-button'),dialog=page.locator('#feed-list-dialog'),downloadLink=dialog.locator('[download]');
  await trigger.click();await expect(dialog).toBeVisible();await expect(page.locator('#feed-list-title')).toBeFocused();
  expect(downloads).toHaveLength(0);
  const guides=dialog.locator('.import-guides a');await expect(guides).toHaveCount(6);
  for(const link of await guides.all()) {
    await expect(link).toHaveAttribute('href',/^https:\/\//);await expect(link).toHaveAttribute('target','_blank');await expect(link).toHaveAttribute('rel','noopener noreferrer');
  }
  const helpUrl=await guides.first().getAttribute('href');
  await context.route(helpUrl,route=>route.fulfill({contentType:'text/html',body:'<h1>Reader import instructions</h1>'}));
  const popupPromise=page.waitForEvent('popup');await guides.first().click();const popup=await popupPromise;
  await expect(popup).toHaveURL(helpUrl);await popup.close();await expect(dialog).toBeVisible();expect(downloads).toHaveLength(0);
  await dialog.locator('.close-button').focus();await trigger.focus();await expect(dialog.locator('.close-button')).toBeFocused();
  const downloadPromise=page.waitForEvent('download');await downloadLink.click();const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe('feeds.opml');expect(await download.failure()).toBeNull();
  expect(await readFile(await download.path(),'utf8')).toBe(await readFile(new URL('../../feeds.opml',import.meta.url),'utf8'));
  await expect(dialog).toBeVisible();await expect(guides.first()).toBeVisible();expect(downloads).toHaveLength(1);
  await page.goBack();await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
  await page.goForward();await expect(dialog).toBeVisible();await page.reload();await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
  await page.goto('./#feed-list=1');await expect(dialog).toBeVisible();await dialog.locator('.close-button').click();await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/feed-list/);
  await trigger.click();await page.mouse.click(1,1);await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
});

test('feed list guide works when the catalog cannot load',async({page})=>{
  await page.route('**/catalog.json',route=>route.abort('internetdisconnected'));
  await page.goto('./');await expect(page.locator('#result-label')).toHaveText('The reader could not open your library.');
  await page.locator('#feed-list-button').click();await expect(page.locator('#feed-list-dialog')).toBeVisible();
  const downloadPromise=page.waitForEvent('download');await page.locator('#feed-list-dialog [download]').click();const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe('feeds.opml');expect(await download.failure()).toBeNull();
  await page.keyboard.press('Escape');await expect(page.locator('#feed-list-dialog')).toBeHidden();await expect(page.locator('#feed-list-button')).toBeFocused();
  await page.locator('#feed-list-button').click();await page.getByRole('button',{name:'Close feed list guide'}).click();await expect(page.locator('#feed-list-dialog')).toBeHidden();
});
