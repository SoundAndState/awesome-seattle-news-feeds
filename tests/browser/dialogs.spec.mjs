import {test, expect, catalog, loadReader} from './fixtures.mjs';
import {articleItem, rssFeed} from '../fixtures/feeds.mjs';

test('short article previews use the available reading height on phones and desktop', async ({page}, testInfo) => {
  const viewport=page.viewportSize();
  await loadReader(page);
  await page.locator('.story-title').first().click();
  const dialog=page.locator('#article-dialog'), body=dialog.locator('#article-body');
  for(const size of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:760,height:360}]) {
    await page.setViewportSize(size);
    const frame=await dialog.boundingBox();
    expect(frame.height).toBeGreaterThanOrEqual(size.height-65);
    expect(frame.y).toBeGreaterThanOrEqual(20);
    expect(frame.y+frame.height).toBeLessThanOrEqual(size.height-20);
    expect((await body.boundingBox()).height).toBeGreaterThan(size.height-155);
    await expect(dialog.locator('.close-button')).toBeInViewport();
    await expect(dialog.locator('.save-button')).toBeInViewport();
    expect(await body.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    if((testInfo.project.name==='chromium'&&size.width===1440)||(testInfo.project.name==='webkit-mobile'&&size.width===390)) {
      await page.screenshot({path:testInfo.outputPath(`preview-${size.width}.png`)});
    }
  }
  await dialog.locator('.close-button').click();
  await expect(dialog).toBeHidden();
  await page.setViewportSize(viewport);
  await page.evaluate(()=>scrollTo(0,0));
  if(['chromium','webkit-mobile'].includes(testInfo.project.name))await page.screenshot({path:testInfo.outputPath('navigation.png')});
});

test('every modal scrolls its content without moving or activating the feed behind it', async ({page,browserName,isMobile}) => {
  const html='<p>Local reporting with enough detail to scroll through the preview.</p>'.repeat(40);
  const bodies=Object.fromEntries(catalog.feeds.map(feed=>[feed.id,rssFeed([articleItem(feed.id,{html})])]));
  await loadReader(page,{bodies});
  await page.locator('#reading-options summary').click();
  await page.locator('#scroll-read').uncheck();
  await page.locator('#reading-options summary').click();
  // Click the already-visible sticky controls without the automation scrolling
  // their ancestors first; this keeps Back to top beneath the backdrop.
  const clickVisible=async selector=>{
    const box=await page.locator(selector).boundingBox();
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  };
  const openResources=async()=>{
    if(await page.locator('#menu-toggle').isVisible())await clickVisible('#menu-toggle');
    await expect(page.locator('#resource-menu')).toBeVisible();
  };
  const openers=[
    ['article-dialog','#article-body',async()=>{await page.locator('.story-title').nth(8).click();}],
    ['about-dialog','.about-content',async()=>{await openResources();await clickVisible('#about-button');}],
    ['filter-dialog','.filter-content',async()=>{await clickVisible('#filter-button');}],
    ['feed-list-dialog','.feed-list-content',async()=>{await openResources();await clickVisible('#feed-list-button');}],
  ];
  // Keep the background Back to top button beneath the bottom-right backdrop.
  for(const [id,content,open] of openers) {
    await page.evaluate(()=>scrollTo(0,1200));
    if(id==='filter-dialog') {
      await openResources();
      if(await page.locator('#menu-filter-button').isVisible()) await clickVisible('#menu-filter-button');
      else await open();
    } else await open();
    const dialog=page.locator(`#${id}`),body=dialog.locator(content);
    await expect(dialog).toBeVisible();
    const y=await page.evaluate(()=>scrollY);
    expect(y).toBeGreaterThan(500);
    expect((await dialog.boundingBox()).height).toBeGreaterThan(page.viewportSize().height-65);
    const touchAllowed=async(x,y)=>page.evaluate(({x,y})=>{
      const target=document.elementFromPoint(x,y);
      const fire=(type,y)=>{
        const event=new Event(type,{bubbles:true,cancelable:true});
        Object.defineProperty(event,'touches',{value:[{clientX:x,clientY:y}]});
        return target.dispatchEvent(event);
      };
      fire('touchstart',y);
      return fire('touchmove',y-40);
    },{x,y});
    const supportsWheel=!(browserName==='webkit'&&isMobile);
    const wheel=async(x,y,delta)=>{
      if(supportsWheel) {
        await page.mouse.move(x,y);await page.mouse.wheel(0,delta);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      }
    };
    await expect(page.locator('html')).toHaveCSS('overflow-y','hidden');
    expect(await touchAllowed(4,page.viewportSize().height/2)).toBe(false);
    await wheel(4,page.viewportSize().height/2,700);
    expect(await page.evaluate(()=>scrollY)).toBe(y);
    const box=await body.boundingBox();
    const canScroll=await body.evaluate(node=>node.scrollHeight>node.clientHeight);
    if(canScroll) {
      expect(await touchAllowed(box.x+box.width/2,box.y+box.height/2)).toBe(true);
      await wheel(box.x+box.width/2,box.y+box.height/2,350);
      // Playwright cannot send wheel gestures to mobile WebKit. Check its touch
      // cancellation above, then exercise the real inner scroll container.
      if(!supportsWheel)await body.evaluate(node=>node.scrollTop=350);
      await expect.poll(()=>body.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
    }
    await body.evaluate(node=>node.scrollTop=node.scrollHeight);
    expect(await touchAllowed(box.x+box.width/2,box.y+box.height/2)).toBe(false);
    await wheel(box.x+box.width/2,box.y+box.height/2,700);
    expect(await page.evaluate(()=>scrollY)).toBe(y);
    await expect(dialog.locator('.close-button')).toBeInViewport();
    // A tap on the backdrop must dismiss the modal without clicking Back to top.
    await page.mouse.click(page.viewportSize().width-20,page.viewportSize().height-20);
    await expect(dialog).toBeHidden();
    expect(Math.abs(await page.evaluate(()=>scrollY)-y)).toBeLessThan(2);
  }
  await expect(page.locator('html')).not.toHaveCSS('overflow-y','hidden');
  if(!(browserName==='webkit'&&isMobile)) {
    const y=await page.evaluate(()=>scrollY);
    await page.mouse.move(page.viewportSize().width/2,page.viewportSize().height/2);await page.mouse.wheel(0,400);
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(y);
  }
});
