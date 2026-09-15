import {test, expect} from '@playwright/test';

const fixture = id => `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Publisher</title><description>Local reporting</description><item><title>Seattle parks get a new trail — ${id}</title><link>https://publisher.example/${id}</link><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</pubDate><content:encoded><![CDATA[<p>A new trail connects two neighborhoods.</p><script>window.compromised=true</script><img src="https://tracker.example/pixel" onerror="window.compromised=true"><a href="javascript:alert(1)">Unsafe link</a><a href="/more">More reporting</a>]]></content:encoded></item></channel></rss>`;
async function load(page, fail = false) {
  await page.route('https://awesome-seattle-feed-proxy.bmenesini.workers.dev/feed/*', route => {
    const id = route.request().url().split('/').pop();
    return route.fulfill({status: fail ? 502 : 200, contentType: fail ? 'application/json' : 'application/xml', body: fail ? JSON.stringify({error:'Publisher returned HTTP 403.'}) : fixture(id)});
  });
  await page.goto('./'); await expect(page.getByRole('button', {name:'Refresh',exact:true})).toBeEnabled({timeout:30000});
  await expect(page.locator('#all-count')).toHaveText(fail ? '0' : '96');
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
  await page.route('https://awesome-seattle-feed-proxy.bmenesini.workers.dev/feed/*',route=>route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Publisher returned HTTP 403.'})}));
  await page.reload(); await expect(page.locator('#all-count')).toHaveText('96');
  await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeEnabled({timeout:30000});
  await page.getByRole('button',{name:'96 feeds unavailable · View sources'}).click();
  await expect(page.locator('.source-card')).toHaveCount(96); await expect(page.locator('.source-detail').first()).toContainText('Last loaded');
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
  await page.locator('[data-view="sources"]').click(); await expect(page.locator('.source-card')).toHaveCount(96);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
