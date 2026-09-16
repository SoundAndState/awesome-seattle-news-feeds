import {test, expect, catalog, browserCatalog, proxyRoute, proxyFeedUrl, loadReader as load} from './fixtures.mjs';
import {readFile} from 'node:fs/promises';
import {rssFeed, articleItem, defaultFeed as fixture, unsafeHtml} from '../fixtures/feeds.mjs';

const newsCount = catalog.feeds.filter(feed => feed.category !== 'bluesky').length;
const socialCount = catalog.feeds.filter(feed => feed.category === 'bluesky').length;
const paginationCatalog = browserCatalog({regionalCount:62});

async function chooseSource(page,id) {await page.locator('#filter-button').click();await page.locator(`[data-source="${id}"]`).click();await expect(page.locator('#filter-dialog')).toBeHidden();}
async function chooseSection(page,id) {await page.locator('#filter-button').click();await page.locator(`[data-category="${id}"]`).click();await expect(page.locator('#filter-dialog')).toBeHidden();}
async function search(page,text) {if(await page.locator('#search-panel').isHidden())await page.locator('#search-toggle').click();await page.locator('#search').fill(text);}
async function sources(page) {await page.locator('#filter-button').click();await page.locator('#browse-sources').click();}
async function expireFeeds(page) {await page.evaluate(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('sound-and-state');r.onsuccess=()=>res(r.result);r.onerror=rej;});await new Promise((res,rej)=>{const tx=db.transaction('feeds','readwrite'),r=tx.objectStore('feeds').openCursor();r.onsuccess=()=>{const c=r.result;if(c){c.update({...c.value,nextCheck:0});c.continue();}};tx.oncomplete=res;tx.onerror=rej;});db.close();});}

test('fixture catalog, pagination, scoped search, source selection and section chips work',async({page})=>{
  await load(page,{catalog:paginationCatalog});await expect(page.locator('.story')).toHaveCount(60);
  await page.locator('#load-more').click();await expect(page.locator('.story')).toHaveCount(paginationCatalog.feeds.filter(feed=>feed.category!=='bluesky').length);
  await search(page,'transit-news');await expect(page.locator('.story')).toHaveCount(1);
  await search(page,'');await chooseSource(page,'transit-news');await expect(page.locator('.story')).toHaveCount(1);
  await expect(page.locator('#filter-chips')).toContainText('Transit News');
  await page.getByRole('button',{name:'Clear all',exact:true}).click();await chooseSection(page,'satire');
  await expect(page.locator('.story')).toHaveCount(1);await expect(page.locator('.category-satire')).toHaveText('Satire');
});

test('Back and Forward restore filters, searches, source directory and reloads',async({page})=>{
  await load(page);await chooseSection(page,'transport');await expect(page).toHaveURL(/#section=transport$/);
  await chooseSource(page,'transit-news');await page.locator('#search-toggle').click();await page.locator('#search').pressSequentially('Seattle parks');await page.locator('#search').blur();
  await sources(page);await expect(page.locator('.source-card')).toHaveCount(newsCount);
  await page.goBack();await expect(page.locator('#search')).toHaveValue('Seattle parks');await expect(page.locator('#filter-chips')).toContainText('Transit News');
  await page.goBack();await expect(page.locator('#search')).toHaveValue('');
  await page.goBack();await expect(page.locator('#filter-chips')).toContainText('Transit & urbanism');
  // Same-document navigation can resolve before the browser dispatches popstate.
  // Wait for each restored route before navigating again or reloading it.
  await page.goForward();await expect(page).toHaveURL(/#source=transit-news$/);await expect(page.locator('#filter-chips')).toContainText('Transit News');
  await page.goForward();await expect(page.locator('#search')).toHaveValue('Seattle parks');await expect(page).toHaveURL(/q=Seattle\+parks$/);
  await page.reload();await expect(page.locator('#search')).toHaveValue('Seattle parks');await expect(page.locator('.story')).toHaveCount(1);
});

test('preview history restores scroll and keyboard focus; direct links close locally',async({page})=>{
  await load(page);const story=page.locator('.story-title').nth(8);await story.scrollIntoViewIfNeeded();const y=await page.evaluate(()=>scrollY),id=await story.getAttribute('data-story');
  await story.click();await expect(page.locator('#article-dialog')).toBeVisible();await expect(page.locator('#article-title')).toBeFocused();
  await page.goBack();await expect(page.locator('#article-dialog')).toBeHidden();expect(Math.abs(await page.evaluate(()=>scrollY)-y)).toBeLessThan(5);await expect(page.locator(`[data-story="${id}"]`)).toBeFocused();
  await page.goForward();await expect(page.locator('#article-dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#article-dialog')).toBeHidden();
  await page.getByRole('button',{name:'About this reader'}).click();await page.goBack();await expect(page.locator('#about-dialog')).toBeHidden();await expect(page.locator('#about-button')).toBeFocused();
  await page.goto(`./#article=${encodeURIComponent(id)}`);await expect(page.locator('#article-dialog')).toBeVisible();await page.getByRole('button',{name:'Close story',exact:true}).click();await expect(page.locator('#article-dialog')).toBeHidden();await expect(page.locator('.story')).toHaveCount(newsCount);
});

test('unavailable sources stay separate from Posts and history restores them',async({page})=>{
  await load(page,{fail:true});await page.getByRole('button',{name:`${newsCount} unavailable`,exact:true}).click();await expect(page.locator('.source-card')).toHaveCount(newsCount);
  await page.unroute(proxyRoute);await page.route(proxyRoute,r=>r.fulfill({contentType:'application/xml',body:fixture(r.request().url().split('/').pop())}));
  await page.locator('[data-mode="posts"]').click();await expect(page.locator('.post')).toHaveCount(socialCount);await expect(page.locator('.status-link')).toHaveCount(0);
  await page.goBack();await expect(page.locator('h1')).toHaveText('Unavailable sources');await expect(page.locator('.source-card')).toHaveCount(newsCount);await page.goForward();await expect(page.locator('.post')).toHaveCount(socialCount);
});

test('read and saved state persist and feed HTML cannot execute or load trackers',async({page})=>{
  const trackers=[];page.on('request',r=>{if(r.url().includes('tracker.example'))trackers.push(r.url());});await load(page,{bodies:{'transit-news':rssFeed([articleItem('transit-news',{html:unsafeHtml})])}});await chooseSource(page,'transit-news');
  await page.locator('.save-button').click();await page.locator('.story-title').click();await expect(page.locator('.article-content')).toContainText('A new trail');
  await expect(page.locator('.article-content script,.article-content img')).toHaveCount(0);await expect(page.locator('.article-content a').filter({hasText:'Unsafe link'})).not.toHaveAttribute('href');await expect(page.locator('.article-content a').filter({hasText:'More reporting'})).toHaveAttribute('href','https://publisher.example/more');
  expect(await page.evaluate(()=>window.compromised)).toBeUndefined();expect(trackers).toHaveLength(0);
  await page.getByRole('button',{name:'Close story',exact:true}).click();await page.reload();await page.locator('#saved-button').click();await expect(page.locator('.story')).toHaveCount(1);await expect(page.locator('.story')).toHaveClass(/is-read/);
});

test('failed refresh preserves cached content, explains failures and retries only failed feeds',async({page})=>{
  await load(page);await expireFeeds(page);await page.unroute(proxyRoute);
  const failed=catalog.feeds.filter(f=>f.category!=='bluesky').slice(0,2),ids=failed.map(f=>f.id);
  await page.route(proxyRoute,r=>{const id=r.request().url().split('/').pop();return r.fulfill({status:ids.includes(id)?502:200,contentType:ids.includes(id)?'application/json':'application/xml',body:ids.includes(id)?'{"error":"Publisher returned HTTP 403."}':fixture(id)});});
  await page.reload();await expect(page.getByRole('button',{name:'2 unavailable',exact:true})).toBeVisible();await expect(page.locator('#feed-progress')).toContainText('The reader last checked feeds');await expect(page.locator('#refresh')).toBeEnabled();await expect(page.locator('#all-count')).toHaveText(String(newsCount));
  await search(page,'nothing matches');await page.getByRole('button',{name:'2 unavailable',exact:true}).click();await expect(page.locator('.source-card')).toHaveCount(2);
  for(const card of await page.locator('.source-card').all()){await expect(card).toContainText('Using an earlier copy');await expect(card).toContainText('A server refused the feed request');await card.locator('summary').click();await expect(card.locator('details')).toContainText('HTTP 403');}
  const requests=[];page.on('request',r=>{if(r.url().startsWith(proxyFeedUrl('')))requests.push(r.url().split('/').pop());});await page.locator('#refresh').click();await expect(page.locator('#refresh')).toBeEnabled();expect(requests.sort()).toEqual(ids.sort());
  await page.getByRole('button',{name:'Show all sources',exact:true}).click();await expect(page.locator('.source-card')).toHaveCount(newsCount);
});

test('backup restores article and post saves into a fresh library',async({page,newReaderPage})=>{
  await load(page);await page.locator('.save-button').first().click();await page.locator('[data-mode="posts"]').click();await expect(page.locator('.post')).toHaveCount(socialCount);await page.locator('.save-button').first().click();
  await page.locator('#about-button').click();const downloadPromise=page.waitForEvent('download');await page.locator('#export-state').click();const backup=await (await downloadPromise).path();
  const fresh=await newReaderPage();await load(fresh,{fail:true});await fresh.locator('#about-button').click();await fresh.locator('#backup-file').setInputFiles(backup);await expect(fresh.locator('#backup-status')).toContainText('The reader combined 2 saved items');
  await fresh.getByRole('button',{name:'Close about'}).click();await fresh.locator('#saved-button').click();await expect(fresh.locator('.story')).toHaveCount(2);await expect(fresh.locator('.post')).toHaveCount(1);await expect(fresh.locator('.story-updated time')).toHaveAttribute('datetime','2026-09-15T12:45:00.000Z');await fresh.context().close();
});

test('unreadable backups explain recovery without changing the library',async({page})=>{
  await load(page);await page.locator('.save-button').first().click();await page.locator('#about-button').click();
  const backup={format:'sound-and-state',version:1,state:[],savedArticles:[]};
  for(const [body,message] of [
    ['{broken','Choose a file from Export reading backup.'],
    ['null','Choose a JSON backup from Export reading backup.'],
    [JSON.stringify({...backup,state:[null]}),'cannot read which items this backup marks as read or saved'],
    [JSON.stringify({...backup,savedArticles:[null]}),'cannot read a saved item in this backup'],
  ]) {
    await page.locator('#backup-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(body)});
    await expect(page.locator('#backup-status')).toContainText(message);
    await expect(page.locator('#saved-count')).toHaveText('1');
  }
  await page.getByRole('button',{name:'Close about'}).click();await page.locator('#saved-button').click();await expect(page.locator('.story')).toHaveCount(1);
});

test('mobile navigation reaches content quickly and filters close after selection',async({page})=>{
  await page.setViewportSize({width:390,height:844});await load(page);
  expect(await page.locator('.story h2').first().evaluate(n=>n.getBoundingClientRect().top)).toBeLessThanOrEqual(374);
  expect(await page.locator('.story h2').nth(1).evaluate(n=>n.getBoundingClientRect().top)).toBeLessThan(844);
  await chooseSection(page,'transport');await expect(page.locator('#filter-chips')).toContainText('Transit & urbanism');
  await page.locator('#filter-button').click();await page.locator('#source-search').fill('transit news');await expect(page.locator('.source-choice')).toHaveCount(1);await page.locator('.source-choice').click();await expect(page.locator('.story')).toHaveCount(1);
  for(const width of [320,390,760,900,1440]){
    await page.setViewportSize({width,height:900});
    await expect.poll(()=>page.evaluate(width=>{
      const read=document.querySelector('.read-button').getBoundingClientRect(),save=document.querySelector('.save-button').getBoundingClientRect(),logo=document.querySelector('.brand-icon').getBoundingClientRect();
      return {
        viewportMatches: innerWidth===width,
        fitsViewport: document.documentElement.scrollWidth<=innerWidth,
        touchTargetFits: read.height>=44,
        actionsAlign: Math.abs(read.y-save.y)<.5,
        // Browser layout rounds fractional SVG dimensions independently.
        logoIsSquare: Math.abs(logo.width-logo.height)<.01,
      };
    },width)).toEqual({viewportMatches:true,fitsViewport:true,touchTargetFits:true,actionsAlign:true,logoIsSquare:true});
  }
});

test('mode switches restore independent filters, searches and reading positions',async({page})=>{
  await load(page);await chooseSection(page,'regional');await search(page,'Seattle');await page.locator('#search').blur();await page.locator('.story').nth(6).scrollIntoViewIfNeeded();const y=await page.evaluate(()=>scrollY);
  await page.locator('[data-mode="posts"]').click();await expect(page.locator('.post')).toHaveCount(socialCount);await search(page,'parks');await page.locator('#search').blur();
  await page.locator('[data-mode="articles"]').click();await expect(page.locator('#filter-chips')).toContainText('Seattle & regional');await expect(page.locator('#search')).toHaveValue('Seattle');expect(Math.abs(await page.evaluate(()=>scrollY)-y)).toBeLessThan(5);
  await page.locator('[data-mode="posts"]').click();await expect(page.locator('#search')).toHaveValue('parks');await expect(page.locator('.story h2')).toHaveCount(0);await expect(page.locator('.post-text').first()).toContainText('Parks & trails <3');
});

test('Saved is global, resets inherited filters and has independent type filters',async({page})=>{
  const socialRequests=[];page.on('request',r=>{if(r.url().includes('/feed/bluesky-'))socialRequests.push(r.url());});await load(page);expect(socialRequests).toHaveLength(0);
  await page.locator('.save-button').first().click();await chooseSource(page,'transit-news');await search(page,'does not match');await page.locator('#saved-button').click();await expect(page.locator('h1')).toHaveText('Saved items');await expect(page.locator('.story')).toHaveCount(1);await expect(page.locator('#filter-chips')).toBeHidden();
  await page.locator('[data-mode="posts"]').click();await expect(page.locator('.post')).toHaveCount(socialCount);expect(socialRequests).toHaveLength(socialCount);await page.locator('.save-button').first().click();await page.locator('#saved-button').click();await expect(page.locator('.story')).toHaveCount(2);await expect(page.locator('#saved-count')).toHaveText('2');
  await page.locator('[data-kind="articles"]').click();await expect(page.locator('.story')).toHaveCount(1);await expect(page.locator('.post')).toHaveCount(0);
  await page.locator('[data-kind="posts"]').click();await expect(page.locator('.post')).toHaveCount(1);await search(page,'no saved item matches');await expect(page.locator('.empty-state')).toContainText('No saved items match.');
  await page.reload();await expect(page.locator('#saved-count')).toHaveText('2');await page.locator('#saved-button').click();await expect(page.locator('.story')).toHaveCount(2);
});

test('metadata follows article titles and archives remain private until clicked',async({page})=>{
  const requests=[];page.on('request',r=>{if(r.url().startsWith('https://ghostarchive.org/'))requests.push(r.url());});await load(page);await chooseSource(page,'transit-news');const story=page.locator('.story');
  expect(await story.evaluate(n=>Boolean(n.querySelector('h2').compareDocumentPosition(n.querySelector('.story-meta')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  const expected='https://ghostarchive.org/search?go=Go&term='+encodeURIComponent('https://publisher.example/transit-news?edition=local');await expect(story.locator('.archive-link')).toHaveAttribute('href',expected);
  await expect(story.locator('.publisher')).toHaveAttribute('href',new URL(catalog.feeds.find(f=>f.id==='transit-news').website).href);
  for(const link of await story.locator('.publisher-link').all()){expect(await link.textContent()).toContain('↗\uFE0E');await expect(link).toHaveAttribute('rel','noopener noreferrer');}
  await story.locator('.story-title').click();await expect(page.locator('#article-dialog .archive-link')).toHaveCount(1);
  for(const link of await page.locator('#article-dialog .archive-link').all())await expect(link).toHaveAttribute('href',expected);
  expect(requests).toHaveLength(0);
});

test('cards and previews label full dates, including update-only and date-only entries',async({page})=>{
  const id='transit-news';let xml=fixture(id);
  await page.route(proxyRoute,r=>r.fulfill({contentType:'application/xml',body:xml}));
  await page.goto(`./#source=${id}`);await expect(page.locator('.story')).toHaveCount(1);
  await expect(page.locator('.story-published time')).toHaveAttribute('datetime','2026-09-15T10:00:00.000Z');
  await expect(page.locator('.story-updated time')).toHaveAttribute('datetime','2026-09-15T12:45:00.000Z');
  for(const field of ['published','updated'])await expect(page.locator(`.story-${field}`)).toHaveText(new RegExp(`^${field==='published'?'Published':'Updated'} Sep 15, 2026, .*[0-9]:[0-9]{2} .*`));
  await page.locator('.story-title').click();await expect(page.locator('#article-dialog .story-updated time')).toHaveAttribute('datetime','2026-09-15T12:45:00.000Z');await page.keyboard.press('Escape');await expect(page.locator('#article-dialog')).toBeHidden();
  await page.locator('.story .save-button').click();const download=page.waitForEvent('download');await page.locator('#export-saved').click();const csv=await readFile(await(await download).path(),'utf8');expect(csv).toContain('"Read","Updated"');expect(csv).toContain('2026-09-15T12:45:00.000Z');
  xml=fixture(id).replace(/<pubDate>.*?<\/pubDate>/,'');await expireFeeds(page);await page.reload();await expect(page.locator('#refresh')).toBeEnabled();await expect(page.locator('.story-published')).toHaveCount(0);await expect(page.locator('.story-updated')).toContainText('2026');
  xml=fixture(id).replace(/<pubDate>.*?<\/pubDate>/,'<pubDate>2026-09-14</pubDate>').replace(/<atom:updated>.*?<\/atom:updated>/,'<atom:updated>2026-09-15</atom:updated>');await expireFeeds(page);await page.reload();await expect(page.locator('#refresh')).toBeEnabled();await expect(page.locator('.story-published')).toHaveText('Published Sep 14, 2026');await expect(page.locator('.story-updated')).toHaveText('Updated Sep 15, 2026');await expect(page.locator('.story-published time')).toHaveAttribute('datetime','2026-09-14');
  xml=fixture(id).replace(/<pubDate>.*?<\/pubDate>/,'').replace(/<atom:updated>.*?<\/atom:updated>/,'');await expireFeeds(page);await page.reload();await expect(page.locator('#refresh')).toBeEnabled();await expect(page.locator('.story-dates')).toHaveText('No date in feed');await expect(page.locator('.story time')).toHaveCount(0);
});

test('direct fallback omits credentials and source errors explain both attempts',async({page})=>{
  const [allowed,blocked]=catalog.feeds.filter(f=>f.category!=='bluesky'),requests=[];
  await page.context().addCookies([{name:'private-session',value:'not-for-feeds',url:allowed.feed}]);
  await page.route(allowed.feed,r=>{requests.push(r.request());return r.fulfill({contentType:'application/xml',headers:{'access-control-allow-origin':'*'},body:fixture(allowed.id)});});
  await page.route(blocked.feed,r=>r.fulfill({contentType:'application/xml',headers:{'access-control-allow-origin':'https://other.example'},body:fixture(blocked.id)}));
  await page.route(proxyRoute,r=>{const id=r.request().url().split('/').pop(),fail=[allowed.id,blocked.id].includes(id);return r.fulfill({status:fail?502:200,contentType:fail?'application/json':'application/xml',body:fail?'{"error":"Publisher denied proxy request."}':fixture(id)});});
  await page.goto('./');await expect(page.locator('#feed-progress')).toContainText('The reader last checked feeds');await expect(page.locator('#all-count')).toHaveText(String(newsCount-1));await expect(page.locator('#refresh')).toBeEnabled();expect(requests).toHaveLength(1);expect(requests[0].headers()).not.toHaveProperty('cookie');expect(requests[0].headers()).not.toHaveProperty('referer');
  await page.getByRole('button',{name:'1 unavailable',exact:true}).click();await expect(page.locator('.source-card')).toHaveCount(1);await page.locator('.source-card summary').click();await expect(page.locator('.source-card details')).toContainText('Through Cloudflare: Publisher denied proxy request. Direct from the publisher: Your browser could not load the feed directly.');
  await page.getByRole('button',{name:'Show all sources',exact:true}).click();await expect(page.locator('.source-card').filter({has:page.getByRole('heading',{name:allowed.name,exact:true})})).toContainText('Your browser connected directly to the publisher.');
});

test('scroll marking is opt-in, persistent and does not move the Unread list',async({page})=>{
  await load(page);await page.locator('[data-view="unread"]').click();const first=page.locator('.story').first();const past=()=>page.evaluate(()=>scrollBy(0,document.querySelector('.story').getBoundingClientRect().bottom+2));
  await expect(page.locator('#scroll-read')).not.toBeChecked();await past();await page.evaluate(()=>new Promise(requestAnimationFrame));await expect(first).not.toHaveClass(/is-read/);
  await page.evaluate(()=>scrollTo(0,0));await page.locator('#reading-options summary').click();await page.locator('#scroll-read').check();await page.locator('#reading-options summary').click();
  const y=await first.evaluate(n=>scrollY+n.getBoundingClientRect().bottom+2);await past();await expect(first).toHaveClass(/is-read/);expect(Math.abs(await page.evaluate(()=>scrollY)-y)).toBeLessThan(1);await expect(page.locator('.story')).toHaveCount(newsCount);await expect(page.locator('#unread-count')).toHaveText(String(newsCount-1));
  await page.reload();await expect(page.locator('#scroll-read')).toBeChecked();await expect(page.locator('#unread-count')).toHaveText(String(newsCount-1));
});

test('bulk read states its full scope and Undo preserves previously read and saved states',async({page})=>{
  const newsCount=paginationCatalog.feeds.filter(feed=>feed.category!=='bluesky').length;
  await load(page,{catalog:paginationCatalog});const first=page.locator('.story').first(),id=await first.getAttribute('data-article');await first.locator('.save-button').click();await first.locator('.read-button').click();await page.locator('[data-view="unread"]').click();await page.locator('#reading-options summary').click();
  await expect(page.locator('.story')).toHaveCount(60);await expect(page.locator('#mark-read')).toHaveText(`Mark ${newsCount-1} matching articles read`);await page.locator('#mark-read').click();await expect(page.locator('#unread-count')).toHaveText('0');await expect(page.locator('#undo-read')).toBeFocused();
  await page.locator('#undo-read').click();await expect(page.locator('#unread-count')).toHaveText(String(newsCount-1));await page.locator('#saved-button').click();await expect(page.locator('.story')).toHaveAttribute('data-article',id);await expect(page.locator('.story')).toHaveClass(/is-read/);
});

test('removing a focused unread or saved item moves focus to the next item',async({page})=>{
  await load(page);await page.locator('[data-view="unread"]').click();const secondId=await page.locator('.story').nth(1).getAttribute('data-article');await page.locator('.read-button').first().focus();await page.keyboard.press('Enter');await expect(page.locator(`.story[data-article="${secondId}"] [data-story]`)).toBeFocused();
  await page.locator('.save-button').nth(0).click();await page.locator('.save-button').nth(1).click();await page.locator('#saved-button').click();await page.locator('.save-button').first().focus();await page.keyboard.press('Enter');await expect(page.locator('.story')).toHaveCount(1);await expect(page.locator('.story [data-story]')).toBeFocused();
});

test('catalog outage preserves access to the cached saved library',async({page})=>{
  await load(page);await page.locator('.save-button').first().click();await page.locator('#saved-button').click();await page.route('**/catalog.json',r=>r.abort('internetdisconnected'));await page.route('**/feeds.opml',r=>r.abort('internetdisconnected'));await page.reload();await expect(page.locator('.story')).toHaveCount(1);await expect(page.locator('#notice')).toContainText('The reader could not download the latest feed list, so it is using an earlier copy.');await expect(page.locator('#saved-count')).toHaveText('1');
});

test('automatic due refresh buffers new items until accepted and never fetches the inactive mode',async({page})=>{
  let revision=0;const requests=[];await page.route(proxyRoute,r=>{const id=r.request().url().split('/').pop();requests.push(id);return r.fulfill({contentType:'application/xml',body:revision?fixture(id).replaceAll(`https://publisher.example/${id}?`,`https://publisher.example/${id}-new?`):fixture(id)});});
  await page.goto('./');await expect(page.locator('#feed-progress')).toContainText('The reader last checked feeds');await expect(page.locator('#all-count')).toHaveText(String(newsCount));await expect(page.locator('#refresh')).toBeEnabled();const firstId=await page.locator('.story').first().getAttribute('data-article');revision=1;
  await page.clock.fastForward(16*60*1000);await expect(page.locator('#new-items')).toContainText(`${newsCount} new articles`);await expect(page.locator('#refresh')).toBeEnabled();await expect(page.locator('#all-count')).toHaveText(String(newsCount));await expect(page.locator('.story').first()).toHaveAttribute('data-article',firstId);
  expect(requests).toHaveLength(newsCount*2);expect(requests.some(id=>id.startsWith('bluesky-'))).toBe(false);await page.locator('#new-items').click();await expect(page.locator('#all-count')).toHaveText(String(newsCount*2));await expect(page.locator('#new-items')).toBeHidden();
});

test('legacy Bluesky links resolve to Posts with a scoped account picker',async({page})=>{
  await load(page);await page.goto('./#section=bluesky');await expect(page.locator('.post')).toHaveCount(socialCount);await expect(page).toHaveURL(/#mode=posts$/);await page.locator('#filter-button').click();await expect(page.locator('#section-filter')).toBeHidden();await expect(page.locator('.source-choice')).toHaveCount(socialCount);
  const id=catalog.feeds.find(f=>f.category==='bluesky').id;await page.locator(`[data-source="${id}"]`).click();await expect(page.locator('.post')).toHaveCount(1);await page.goto(`./#source=${id}`);await expect(page.locator('[data-mode="posts"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('.post')).toHaveCount(1);
});

test('CSV includes all saved types regardless of filters; About explains cookies and storage',async({page})=>{
  await load(page);await expect(page.locator('#export-saved')).toBeDisabled();await page.locator('.save-button').first().click();await page.locator('[data-mode="posts"]').click();await expect(page.locator('.post')).toHaveCount(socialCount);await page.locator('.save-button').first().click();await search(page,'nothing matches');
  const promise=page.waitForEvent('download');await page.locator('#export-saved').click();const download=await promise,csv=await readFile(await download.path(),'utf8');expect(csv).toContain('"Title","Source","Published","URL","Content","Read"');expect(csv).toContain('https://publisher.example/');expect(csv).toContain('https://bsky.app/profile/');expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3);
  await page.locator('#about-button').click();await expect(page.locator('.about-content')).toContainText('does not set or read cookies');await expect(page.locator('.about-content')).toContainText('It does not upload or sync them.');
});

test('older libraries remain readable if no catalog has been cached yet',async({page})=>{
  await load(page);await page.locator('.save-button').first().click();await page.locator('#saved-button').click();
  await page.evaluate(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('sound-and-state');r.onsuccess=()=>res(r.result);r.onerror=rej;});await new Promise((res,rej)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').delete('catalog');tx.oncomplete=res;tx.onerror=rej;});db.close();});
  await page.route('**/catalog.json',r=>r.abort('internetdisconnected'));await page.route('**/feeds.opml',r=>r.abort('internetdisconnected'));await page.reload();await expect(page.locator('.story')).toHaveCount(1);await expect(page.locator('#notice')).toContainText('You can still browse the items it already has in your library.');await page.locator('[data-mode="articles"]').click();await expect(page.locator('#all-count')).toHaveText(String(newsCount));
});

test('switching modes cancels the previous fetch queue without marking sources unavailable',async({page})=>{
  let releaseNews;const waiting=new Promise(resolve=>{releaseNews=resolve;});
  const requests=[];await page.route(proxyRoute,async r=>{const id=r.request().url().split('/').pop();requests.push(id);if(!id.startsWith('bluesky-'))await waiting;await r.fulfill({contentType:'application/xml',body:fixture(id)}).catch(()=>{});});
  await page.goto('./');await expect.poll(()=>requests.length).toBeGreaterThan(0);await page.locator('[data-mode="posts"]').click();releaseNews();await expect(page.locator('.post')).toHaveCount(socialCount);expect(requests.filter(id=>!id.startsWith('bluesky-')).length).toBeLessThanOrEqual(4);await expect(page.locator('.status-link')).toHaveCount(0);
});

test('feed list guide stays open when the catalog finishes loading',async({page})=>{
  let releaseCatalog;const ready=new Promise(resolve=>releaseCatalog=resolve);
  await page.route('**/catalog.json',async route=>{await ready;await route.fallback();});
  await page.route(proxyRoute,route=>route.fulfill({contentType:'application/xml',body:fixture(route.request().url().split('/').pop())}));
  await page.goto('./',{waitUntil:'domcontentloaded'});await page.locator('#feed-list-button').click();await expect(page.locator('#feed-list-dialog')).toBeVisible();
  releaseCatalog();await expect(page.locator('#all-count')).toHaveText(String(newsCount));await expect(page.locator('#feed-list-dialog')).toBeVisible();
  await page.goBack();await expect(page.locator('#feed-list-dialog')).toBeHidden();await expect(page.locator('#feed-list-button')).toBeFocused();
});

test('feed list guide fits desktop, phone, landscape and expanded text',async({page})=>{
  await load(page);
  for(const size of [{width:1280,height:900},{width:320,height:568},{width:390,height:844},{width:760,height:360}]) {
    await page.setViewportSize(size);await page.locator('#feed-list-button').click();const dialog=page.locator('#feed-list-dialog');
    await expect(dialog.locator('.close-button')).toBeInViewport();await expect(dialog.locator('[download]')).toBeInViewport();
    expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    await dialog.evaluate(node=>node.scrollTop=node.scrollHeight);await expect(dialog.locator('.close-button')).toBeInViewport();
    await expect(dialog.locator('.import-guides a').last()).toBeInViewport();await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:320,height:568});
  await page.evaluate(()=>{const style=document.createElement('style');style.textContent='* {line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important} p {margin-bottom:2em!important}';document.head.append(style);});
  await page.locator('#feed-list-button').click();const dialog=page.locator('#feed-list-dialog');
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  for(const link of await dialog.locator('.import-guides a').all()){await link.focus();await expect(link).toBeInViewport();}
  await expect(dialog.locator('.close-button')).toBeInViewport();await expect(dialog.locator('[download]')).toBeInViewport();
});

test('phone and landscape dialogs retain close controls and expanded text reflows',async({page})=>{
  await load(page);for(const size of [{width:320,height:568},{width:390,height:844},{width:760,height:360}]){
    await page.setViewportSize(size);await page.locator('#about-button').click();const dialog=page.locator('#about-dialog');expect((await dialog.boundingBox()).height).toBeGreaterThan(size.height-25);
    await dialog.evaluate(n=>n.scrollTop=n.scrollHeight);await expect(page.getByRole('button',{name:'Close about'})).toBeInViewport();await page.keyboard.press('Escape');await expect(page.locator('#about-button')).toBeFocused();
  }
  await page.setViewportSize({width:320,height:568});await page.evaluate(()=>{const s=document.createElement('style');s.textContent='* {line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important} p {margin-bottom:2em!important}';document.head.append(s);});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('#filter-button').click();await expect(page.getByRole('button',{name:'Close filters'})).toBeInViewport();expect(await page.locator('#filter-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
});
