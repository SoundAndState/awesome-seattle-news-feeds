import {test, expect, catalog, browserCatalog, mockCatalog, proxyRoute, proxyFeedUrl} from './fixtures.mjs';
import {defaultFeed as fixture, rssFeed, NOW} from '../fixtures/feeds.mjs';

const news = catalog.feeds.filter(feed => feed.category !== 'bluesky').slice(0, 3);
const posts = catalog.feeds.filter(feed => feed.category === 'bluesky').slice(0, 2);
const smallCatalog = browserCatalog({feeds:[...news,...posts]});
test.use({readerCatalog:smallCatalog});

async function prepare(page, feedsCatalog = smallCatalog) {
  await mockCatalog(page, feedsCatalog);
  const requests = new Map();
  page.on('requestfailed', request => {
    const id = request.url().split('/').pop();
    if (requests.get(id)?.request() === request) requests.delete(id);
  });
  await page.route(proxyRoute, route => {requests.set(route.request().url().split('/').pop(), route);});
  const finish = async (feed, {fail = false, empty = false} = {}) => {
    await expect.poll(() => requests.has(feed.id)).toBe(true);
    const route = requests.get(feed.id); requests.delete(feed.id);
    await route.fulfill({status: fail ? 502 : 200, contentType: fail ? 'application/json' : 'application/xml', body: fail ? '{"error":"Publisher unavailable"}' : empty ? rssFeed([]) : fixture(feed.id)});
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

async function watchLoading(page) {
  await page.addInitScript(() => {
    window.sawFeedLoading = false;
    new MutationObserver(() => {
      if (document.querySelector('#feed-loading')?.hidden === false) window.sawFeedLoading = true;
    }).observe(document, {subtree:true, childList:true, attributes:true, attributeFilter:['hidden']});
  });
}

async function setFeedFreshness(page, nextCheck) {
  await page.evaluate(async nextCheck => {
    const db = await new Promise((resolve, reject) => {const request=indexedDB.open('sound-and-state');request.onsuccess=()=>resolve(request.result);request.onerror=reject;});
    await new Promise((resolve, reject) => {
      const transaction=db.transaction('feeds','readwrite'), request=transaction.objectStore('feeds').openCursor();
      request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.update({...cursor.value,nextCheck});cursor.continue();}};
      transaction.oncomplete=resolve;transaction.onerror=reject;
    });
    db.close();
  }, nextCheck);
}

test('a fresh stored library never flashes a loading strip on reload', async ({page}) => {
  const finish = await prepare(page);
  await page.goto('./');
  for (const feed of news) await finish(feed);
  await expect(page.getByRole('progressbar', {name:'Feed check complete'})).toBeVisible();
  await watchLoading(page);
  let catalogRequest;
  await page.route('**/catalog.json', route => {catalogRequest=route;});
  const requests=[];
  page.on('request', request=>{if(request.url().startsWith(proxyFeedUrl('')))requests.push(request.url());});
  await page.reload();
  await expect(page.locator('.story')).toHaveCount(3);
  await expect(page.locator('#refresh')).toBeEnabled();
  await expect.poll(()=>Boolean(catalogRequest)).toBe(true);
  await catalogRequest.fulfill({json:smallCatalog});
  await page.locator('#refresh').click();
  await expect(page.locator('#feed-loading')).toBeHidden();
  expect(await page.evaluate(()=>window.sawFeedLoading)).toBe(false);
  expect(requests).toEqual([]);
});

test('a queued tab checks the shared cache again before showing progress or fetching feeds', async ({page, context}) => {
  const finish = await prepare(page);
  await page.goto('./');
  for (const feed of news) await finish(feed);
  await expect(page.getByRole('progressbar', {name:'Feed check complete'})).toBeVisible();
  test.skip(!await page.evaluate(()=>Boolean(navigator.locks)), 'This browser does not support shared refresh locks.');
  await setFeedFreshness(page, 0);
  await page.evaluate(()=>new Promise(resolve=>{
    navigator.locks.request('sound-and-state-refresh',()=>new Promise(release=>{window.releaseFeedLock=release;resolve();}));
  }));
  const other=await context.newPage();
  await other.clock.install({time: NOW});
  await prepare(other);await watchLoading(other);
  const requests=[];
  other.on('request', request=>{if(request.url().startsWith(proxyFeedUrl('')))requests.push(request.url());});
  await other.goto('./');
  await expect.poll(()=>other.evaluate(async()=>(await navigator.locks.query()).pending.length)).toBeGreaterThan(0);
  await expect(other.locator('#feed-loading')).toBeHidden();
  await setFeedFreshness(page, Date.parse(NOW)+15*60*1000);
  await page.evaluate(()=>window.releaseFeedLock());
  await expect(other.locator('#refresh')).toBeEnabled();
  await expect(other.locator('.story')).toHaveCount(3);
  expect(await other.evaluate(()=>window.sawFeedLoading)).toBe(false);
  expect(requests).toEqual([]);
  await other.close();
});

test('completion keeps the compact strip and articles at the same height until explicit dismissal', async ({page}, testInfo) => {
  const feeds=catalog.feeds.filter(feed=>feed.category!=='bluesky').slice(0,10);
  const finish = await prepare(page, browserCatalog({feeds}));
  await page.goto('./');
  await finish(feeds[0]);
  for (const feed of feeds.slice(1,-1)) await finish(feed, {empty:true});
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '9');
  const panel=page.locator('#feed-loading'), article=page.locator('.story');
  const before=await panel.boundingBox();
  const top=await article.evaluate(node=>node.getBoundingClientRect().top+scrollY);
  expect(before.height).toBeLessThanOrEqual(80);
  await expect(page.getByRole('button', {name:'Dismiss feed status'})).toBeHidden();
  await finish(feeds.at(-1), {empty:true});
  await expect(page.getByRole('progressbar', {name:'Feed check complete'})).toBeVisible();
  expect((await panel.boundingBox()).height).toBeCloseTo(before.height, 1);
  expect(await article.evaluate(node=>node.getBoundingClientRect().top+scrollY)).toBeCloseTo(top, 1);
  await expect(page.locator('.sk-flow-dot').first()).toHaveCSS('animation-name', 'none');
  const close=page.getByRole('button', {name:'Dismiss feed status'});
  const target=await close.boundingBox();
  expect(target.width).toBeGreaterThanOrEqual(44);expect(target.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:testInfo.outputPath('loading-finished.png')});
  await close.focus();await page.keyboard.press('Enter');
  await expect(panel).toBeHidden();await expect(page.locator('#refresh')).toBeFocused();
  // Dismissal restores the last-checked text, whose wrapping varies by browser.
  expect(await article.evaluate(node=>node.getBoundingClientRect().top+scrollY)).toBeLessThan(top);
});

test('progress counts finished checks, including failures, and stays until dismissed', async ({page}) => {
  const finish = await prepare(page);
  await page.goto('./');
  const bar = page.locator('#loading-bar');
  await expect(bar).toHaveAccessibleName('Loading articles');
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
  await expect(bar).toHaveAttribute('aria-valuetext', '2 of 3 feeds checked');
  expect(await animation.evaluate(node => node === document.querySelector('.sk-flow'))).toBe(true);
  await finish(news[2]);
  await expect(bar).toHaveAccessibleName('Feed check complete');
  await expect(bar).toHaveAttribute('value', '3');
  await expect(page.locator('#loading-result')).toBeVisible();
  await expect(page.locator('#loading-guidance')).toBeHidden();
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
  await expect(bar).toHaveAccessibleName('Feed check complete');
  await expect(page.locator('#new-items')).toContainText('1 new articles');
  await page.getByRole('button', {name:'Dismiss feed status'}).click();
  await expect(page.locator('#feed-loading')).toBeHidden();
  await expect(page.locator('#refresh')).toBeFocused();
});

test('opening the library and catalog does not show feed progress, including an outage', async ({page}) => {
  let catalogRequest;
  await page.route('**/catalog.json', route => {catalogRequest = route;});
  await page.goto('./');
  await expect.poll(() => Boolean(catalogRequest)).toBe(true);
  await expect(page.locator('#feed-loading')).toBeHidden();
  await catalogRequest.abort('failed');
  await expect(page.locator('#feed-loading')).toBeHidden();
  await expect(page.locator('#stories')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#stories')).toContainText('reload the page');
});

test('changing views clears progress while going offline preserves a dismissible paused status', async ({page}) => {
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
  await expect(page.getByRole('progressbar', {name:'Feed check paused'})).toHaveAttribute('value', '0');
  await expect(page.getByRole('button', {name:'Dismiss feed status'})).toBeEnabled();
  await expect(page.locator('#stories')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#notice')).toContainText('offline');
  await page.context().setOffline(false);
  await expect(bar).toHaveAttribute('max', '1');
  await finish(posts[1]);
  await expect(page.getByRole('progressbar', {name:'Feed check complete'})).toBeVisible();
});

test('a filtered source uses its own total and a saved library needs no progress bar', async ({page}) => {
  const finish = await prepare(page);
  await page.goto(`./#source=${news[0].id}`);
  await expect(page.getByRole('progressbar')).toHaveAttribute('max', '1');
  await finish(news[0]);
  await expect(page.getByRole('progressbar', {name:'Feed check complete'})).toBeVisible();
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
    await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(size.width);
    const {fits,panel,bar,labels}=await page.evaluate(()=>({
      fits:document.documentElement.scrollWidth<=innerWidth,
      panel:document.querySelector('#feed-loading').getBoundingClientRect().toJSON(),
      bar:document.querySelector('#loading-bar').getBoundingClientRect().toJSON(),
      labels:['loading-label','loading-count','loading-guidance'].map(id=>document.getElementById(id).getBoundingClientRect().toJSON()),
    }));
    expect(fits).toBe(true);
    expect(bar.width).toBeGreaterThan(200);
    expect(bar.x).toBeGreaterThanOrEqual(panel.x);
    expect(bar.x + bar.width).toBeLessThanOrEqual(panel.x + panel.width);
    for (const box of labels) {
      expect(box.x).toBeGreaterThanOrEqual(panel.x);
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
      expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height);
    }
    if ([390,1440].includes(size.width)) await page.screenshot({path: testInfo.outputPath(`loading-${size.width}.png`)});
  }
  await page.setViewportSize({width:320,height:568});
  await page.route('**/loading-test.css', route => route.fulfill({contentType: 'text/css', body: '.feed-loading strong, #loading-count, #loading-guidance, #loading-result {font-size:28px} .feed-loading * {line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}'}));
  await page.addStyleTag({url: './loading-test.css'});
  await expect(page.locator('#loading-count')).toHaveCSS('font-size', '28px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('#feed-loading').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('loading-enlarged.png')});
  const height = (await page.locator('#feed-loading').boundingBox()).height;
  const top = await page.locator('.story').evaluate(node => node.getBoundingClientRect().top + scrollY);
  await finish(news[1], {empty:true}); await finish(news[2], {empty:true});
  await expect(page.getByRole('progressbar', {name:'Feed check complete'})).toBeVisible();
  expect((await page.locator('#feed-loading').boundingBox()).height).toBeCloseTo(height, 1);
  expect(await page.locator('.story').evaluate(node => node.getBoundingClientRect().top + scrollY)).toBeCloseTo(top, 1);
  await page.screenshot({path: testInfo.outputPath('loading-enlarged-finished.png')});
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
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '1 of 3 feeds checked');
  const response = await page.request.get('./third-party-notices.txt');
  expect(await response.text()).toContain('SpinKit Flow (https://github.com/tobiasahlin/SpinKit)');
  expect(await response.text()).toContain('Copyright (c) 2020 Tobias Ahlin');
});
