import {test, expect} from '@playwright/test';
import catalog from '../../feeds.json' with {type: 'json'};

const newsCount = catalog.feeds.filter(feed => feed.category !== 'bluesky').length;
const socialCount = catalog.feeds.filter(feed => feed.category === 'bluesky').length;
const totalCount = catalog.feeds.length;

const fixture = id => id.startsWith('bluesky-')
  ? `<rss version="2.0"><channel><title>Local voice</title><link>https://bsky.app/profile/example.bsky.social</link><description>Bluesky posts</description><item><description>A new trail connects two neighborhoods.\nParks &amp; trails &lt;3 — ${id} https://example.com/${'a-long-article-link-'.repeat(12)}</description><link>https://bsky.app/profile/example.bsky.social/post/${id}</link><guid isPermaLink="false">at://did:plc:example/app.bsky.feed.post/${id}</guid><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`
  : `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Publisher</title><description>Local reporting</description><item><title>Seattle parks get a new trail — ${id}</title><link>https://publisher.example/${id}?utm_source=rss&amp;edition=local&amp;UTM_medium=feed#section</link><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</pubDate><content:encoded><![CDATA[<p>A new trail connects two neighborhoods.</p><script>window.compromised=true</script><img src="https://tracker.example/pixel" onerror="window.compromised=true"><a href="javascript:alert(1)">Unsafe link</a><a href="/more">More reporting</a>]]></content:encoded></item></channel></rss>`;
async function load(page, fail = false) {
  await page.route('https://awesome-seattle-feed-proxy.bmenesini.workers.dev/feed/*', route => {
    const id = route.request().url().split('/').pop();
    return route.fulfill({status: fail ? 502 : 200, contentType: fail ? 'application/json' : 'application/xml', body: fail ? JSON.stringify({error:'Publisher returned HTTP 403.'}) : fixture(id)});
  });
  await page.goto('./'); await expect(page.getByRole('button', {name:'Refresh',exact:true})).toBeEnabled({timeout:30000});
  await expect(page.locator('#all-count')).toHaveText(fail ? '0' : String(newsCount));
}

test('catalog loads automatically; search, source and section filters work', async ({page}) => {
  await load(page);
  await expect(page.locator('.story')).toHaveCount(60);
  await page.getByRole('searchbox').fill('seattle-transit-blog'); await expect(page.locator('.story')).toHaveCount(1);
  await page.getByRole('searchbox').fill(''); await page.locator('#source-filter').selectOption('seattle-transit-blog'); await expect(page.locator('.story')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Seattle Transit Blog');
  await page.locator('#clear-section').click(); await page.locator('[data-category="satire"]').click();
  await expect(page.locator('.story')).toHaveCount(1); await expect(page.locator('.category-satire')).toBeVisible();
});
test('read and saved state persist; feed HTML cannot execute or load trackers', async ({page}) => {
  const trackers = []; page.on('request', req => {if(req.url().includes('tracker.example')) trackers.push(req.url());});
  await load(page);
  await page.locator('#source-filter').selectOption('seattle-transit-blog');
  await page.locator('.save-button').click(); await page.locator('.story-title').click();
  await expect(page.locator('#article-dialog')).toBeVisible(); await expect(page.locator('.article-content')).toContainText('A new trail');
  await expect(page.locator('.article-content script, .article-content img')).toHaveCount(0);
  await expect(page.locator('.article-content a').filter({hasText:'Unsafe link'})).not.toHaveAttribute('href');
  await expect(page.locator('.article-content a').filter({hasText:'More reporting'})).toHaveAttribute('href','https://publisher.example/more');
  expect(await page.evaluate(() => window.compromised)).toBeUndefined(); expect(trackers).toHaveLength(0);
  await page.getByRole('button',{name:'Close story',exact:true}).click();
  await page.reload(); await expect(page.locator('#saved-count')).toHaveText('1');
  await page.locator('[data-view="saved"]').click(); await expect(page.locator('.story')).toHaveCount(1); await expect(page.locator('.story')).toHaveClass(/is-read/);
});
test('failed refresh preserves cached stories and shows source errors', async ({page}) => {
  await load(page);
  await page.evaluate(async () => {const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('sound-and-state');req.onsuccess=()=>resolve(req.result);req.onerror=reject;}); await new Promise((resolve,reject)=>{const tx=db.transaction('feeds','readwrite');const store=tx.objectStore('feeds');const req=store.openCursor();req.onsuccess=()=>{const cursor=req.result;if(cursor){cursor.update({...cursor.value,nextCheck:0});cursor.continue();}};tx.oncomplete=resolve;tx.onerror=reject;});db.close();});
  await page.unroute('https://awesome-seattle-feed-proxy.bmenesini.workers.dev/feed/*');
  const failedFeeds = catalog.feeds.filter(feed => feed.category !== 'bluesky').slice(0, 2);
  const reasons = new Map([[failedFeeds[0].id, 'Publisher returned HTTP 403.'], [failedFeeds[1].id, 'Publisher took too long to respond.']]);
  await page.route('https://awesome-seattle-feed-proxy.bmenesini.workers.dev/feed/*',route=>{
    const id = route.request().url().split('/').pop();
    return route.fulfill({status:reasons.has(id)?502:200,contentType:reasons.has(id)?'application/json':'application/xml',body:reasons.has(id)?JSON.stringify({error:reasons.get(id)}):fixture(id)});
  });
  await page.reload(); await expect(page.locator('#all-count')).toHaveText(String(newsCount));
  await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled({timeout:30000});
  await page.getByRole('searchbox').fill('no stories match this query');
  await page.getByRole('button',{name:'2 feeds unavailable · View sources'}).click();
  await expect(page.locator('h1')).toHaveText('Unavailable feeds');
  await expect(page.locator('.source-card')).toHaveCount(2);
  for (const feed of failedFeeds) {
    const card=page.locator('.source-card').filter({has:page.getByRole('heading',{name:feed.name,exact:true})});
    await expect(card.locator('.source-detail')).toContainText(reasons.get(feed.id));
    await expect(card.locator('.source-detail')).toContainText('Last loaded');
  }
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByRole('button',{name:'2 feeds unavailable · View sources'})).toBeVisible();
  await page.getByRole('button',{name:'Show all sources',exact:true}).click();
  await expect(page.locator('.source-card')).toHaveCount(totalCount);
});
test('reading backup restores saved stories after local data is cleared', async ({page}) => {
  await load(page); await page.locator('.save-button').first().click(); await page.getByRole('button',{name:'About this reader'}).click();
  const downloadPromise=page.waitForEvent('download'); await page.getByRole('button',{name:'Export reading backup'}).click();
  const download=await downloadPromise; const backupPath=await download.path();
  // A fresh browser context has an independent local library.
  const context=await page.context().browser().newContext({baseURL:'http://127.0.0.1:4173/awesome-seattle-news-feeds/'}); const fresh=await context.newPage(); await load(fresh);
  await fresh.getByRole('button',{name:'About this reader'}).click(); await fresh.locator('#backup-file').setInputFiles(backupPath);
  await expect(fresh.locator('#backup-status')).toContainText('Restored 1 saved stories');
  await fresh.getByRole('button',{name:'Close about'}).click(); await fresh.locator('[data-view="saved"]').click(); await expect(fresh.locator('.story')).toHaveCount(1); await context.close();
});
test('mobile reader has no horizontal overflow and section navigation is accessible',async({page})=>{
  await page.setViewportSize({width:390,height:844}); await load(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Browse sections'}).click(); await expect(page.locator('#categories')).toBeVisible();
  await page.locator('[data-view="sources"]').click(); await expect(page.locator('.source-card')).toHaveCount(totalCount);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Bluesky loads on selection and stays out of the default news timeline after reload', async ({page}) => {
  const socialRequests = [];
  page.on('request', request => {if (request.url().includes('/feed/bluesky-')) socialRequests.push(request.url());});
  await load(page);
  expect(socialRequests).toHaveLength(0);
  await page.locator('[data-category="bluesky"]').click();
  await expect(page.locator('#all-count')).toHaveText(String(socialCount));
  await expect(page.locator('.story')).toHaveCount(socialCount);
  await expect(page.locator('.story-title').first()).toContainText('A new trail connects two neighborhoods.');
  await expect(page.locator('.story-title').first()).toContainText('Parks & trails <3');
  expect(socialRequests).toHaveLength(socialCount);
  await page.locator('.save-button').first().click();
  await page.locator('#clear-section').click();
  await expect(page.locator('#all-count')).toHaveText(String(newsCount));
  await expect(page.locator('.category-bluesky')).toHaveCount(0);
  await page.locator('[data-view="saved"]').click();
  await expect(page.locator('.story')).toHaveCount(1);
  await expect(page.locator('.category-bluesky')).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('#all-count')).toHaveText(String(newsCount));
  await expect(page.locator('.category-bluesky')).toHaveCount(0);
  expect(socialRequests).toHaveLength(socialCount);
});


test('article metadata follows titles, source names are links, and archive links are private until clicked', async ({page}) => {
  const archiveRequests=[];
  page.on('request', request => {if(request.url().startsWith('https://ghostarchive.org/')) archiveRequests.push(request.url());});
  await load(page);
  await expect(page.locator('#page-heading')).toHaveClass(/sr-only/);
  await expect(page.getByRole('link',{name:/Download feed list/})).toBeVisible();
  await expect(page.locator('.wordmark small')).toHaveText('Seattle area');
  await expect(page.locator('.reader-footer a')).toHaveAttribute('href',`https://github.com/${catalog.repository}`);
  await page.locator('#source-filter').selectOption('seattle-transit-blog');
  const story=page.locator('.story');
  await expect(story.locator('.publisher')).toHaveAttribute('href',new URL(catalog.feeds.find(feed=>feed.id==='seattle-transit-blog').website).href);
  expect(await story.evaluate(node=>Boolean(node.querySelector('h2').compareDocumentPosition(node.querySelector('.story-meta')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  const expected='https://ghostarchive.org/search?go=Go&term='+encodeURIComponent('https://publisher.example/seattle-transit-blog?edition=local');
  await expect(story.locator('.archive-link')).toHaveAttribute('href',expected);
  for(const link of await story.locator('.publisher-link').all()) {
    expect(await link.textContent()).toContain('↗\uFE0E');
    await expect(link).toHaveAttribute('rel','noopener noreferrer');
  }
  await story.locator('.story-title').click();
  await expect(page.locator('#article-dialog .archive-link')).toHaveAttribute('href',expected);
  expect(await page.locator('#article-body').evaluate(node=>Boolean(node.querySelector('.article-title').compareDocumentPosition(node.querySelector('.article-meta')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('#article-dialog .publisher')).toHaveAttribute('href',new URL(catalog.feeds.find(feed=>feed.id==='seattle-transit-blog').website).href);
  expect(archiveRequests).toHaveLength(0);
});

test('bookmark and native read controls remain aligned and usable at narrow widths', async ({page}) => {
  await load(page);
  await page.locator('#source-filter').selectOption('seattle-transit-blog');
  const read=page.locator('.story .read-control input');
  for(const width of [320,390,760,900,1440]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const inputBox=await read.boundingBox();
    const labelBox=await page.locator('.read-control span').boundingBox();
    expect(Math.abs(inputBox.y+inputBox.height/2-labelBox.y-labelBox.height/2)).toBeLessThan(2);
    await expect(page.locator('.save-button')).toHaveText('Save');
    await expect(page.locator('.bookmark-icon').last()).toBeVisible();
  }
  await read.check(); await expect(page.locator('.story')).toHaveClass(/is-read/);
  await read.uncheck(); await expect(page.locator('.story')).not.toHaveClass(/is-read/);
  await page.locator('.save-button').click(); await expect(page.locator('.save-button')).toHaveText('Saved');
  await page.reload(); await page.locator('#source-filter').selectOption('seattle-transit-blog');
  await expect(page.locator('.save-button')).toHaveText('Saved'); await expect(read).not.toBeChecked();
});
