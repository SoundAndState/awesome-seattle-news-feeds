import {test, expect, catalog, proxyRoute, waitForHeaderTransitions} from './fixtures.mjs';
import {rssFeed, UPDATED} from '../fixtures/feeds.mjs';

const source = 'transit-news';
const headlines = [
  'A new chapter for Seattle’s waterfront',
  'As costs rise, transit leaders weigh what comes next for the region’s long-awaited light rail expansion',
  'Café culture brings neighbors together',
];
const paragraph = 'A network of walkways and public spaces reconnects downtown with the shore. Residents and small businesses are beginning to see what the changes mean for daily life.';
const xml = rssFeed(headlines.map((title, index) => ({
  title, url: 'https://publisher.example/article-' + index,
  published: index === 2 ? null : 'Tue, 15 Sep 2026 ' + (10 - index) + ':00:00 GMT',
  updated: index === 2 ? null : UPDATED,
  html: index === 2 ? '' : '<p>' + paragraph + '</p><p><em>Café déjà vu — local reporting.</em> ' + paragraph + '</p><h3>What happens next</h3><p>' + paragraph + '</p><p><a href="https://publisher.example/more">More reporting</a></p>',
})));

async function load(page, id = source) {
  await page.route(proxyRoute, route => route.fulfill({contentType:'application/xml', body:xml.replaceAll('publisher.example/', `publisher.example/${route.request().url().split('/').pop()}/`)}));
  await page.goto(`./#view=all&source=${id}`);
  await expect(page.locator('.article-card')).toHaveCount(3);
  await expect(page.locator('#refresh')).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
}

async function noHorizontalOverflow(page, selector) {
  expect(await page.locator(selector).evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
}

for (const [category, label] of [['official', 'Official information'], ['satire', 'Satire'], ['commentary', 'Commentary & advocacy']]) {
  test(`${category} classification stays beside attribution and follows the story into its preview`, async ({page}) => {
    const feed = catalog.feeds.find(item => item.category === category);
    await load(page, feed.id);
    const card = page.locator('.article-card').first();
    await expect(card.locator('.article-attribution .category-tag')).toHaveText(label);
    const headline = card.locator('.story-title');
    await expect(headline).toHaveText(headlines[0]);
    await expect(headline).toHaveAccessibleName(`Preview article: ${headlines[0]}`);
    await expect(headline).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(headline).toHaveAttribute('aria-controls', 'article-dialog');
    await headline.click();
    await expect(page.locator('#article-dialog')).toHaveClass(/article-preview/);
    await expect(page.locator('#article-dialog .category-tag')).toHaveText(label);
    await expect(page.locator('#article-dialog .article-read-status')).toHaveText('Read');
    await expect(page.locator('#article-dialog .story-published')).toContainText('Published');
    await expect(page.locator('#article-dialog .story-updated')).toContainText('Updated');
    await page.keyboard.press('Escape');
    await expect(headline).toBeFocused();
  });
}

test('read and saved states preserve card geometry and keep active controls legible', async ({page}) => {
  await load(page);
  const card = page.locator('.article-card').first();
  const height = (await card.boundingBox()).height;
  const headlineGeometry = () => card.evaluate(node => {
    const title = node.querySelector('.story-title').getBoundingClientRect(), card = node.getBoundingClientRect();
    return {x:title.x - card.x, y:title.y - card.y, width:title.width, height:title.height};
  });
  const titleBox = await headlineGeometry();
  await expect(card.locator('.article-read-status')).toHaveCount(0);
  for (const saved of [false, true]) {
    if (saved) await card.locator('.save-button').click();
    await expect(card.locator('.save-button')).toHaveAttribute('aria-pressed', String(saved));
    await expect(card.locator('.save-button')).toHaveAccessibleName(new RegExp(`^${saved ? 'Saved' : 'Save'} `));
    for (const read of [true, false]) {
      await card.locator('.read-button').click();
      await expect(card.locator('.read-button')).toHaveAttribute('aria-pressed', String(read));
      await expect.poll(() => card.locator('.story-copy').evaluate(node => getComputedStyle(node, '::before').content)).toBe(read ? '""' : 'none');
      const geometry = await headlineGeometry();
      for (const key of Object.keys(titleBox)) expect(Math.abs(geometry[key] - titleBox[key])).toBeLessThan(.05);
      expect(Math.abs((await card.boundingBox()).height - height)).toBeLessThan(1);
      const ratios = await card.evaluate(node => {
        const luminance = color => {
          const [r,g,b] = color.match(/[\d.]+/g).slice(0,3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
          return .2126*r + .7152*g + .0722*b;
        };
        return [...node.querySelectorAll('.headline-text,.excerpt,.publisher,.story-dates,.save-button,.read-button,.publisher-link')].map(element => {
          let background = element;
          while (getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)') background = background.parentElement;
          const a = luminance(getComputedStyle(element).color), b = luminance(getComputedStyle(background).backgroundColor);
          return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
        });
      });
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  }
  await page.setViewportSize({width:390,height:568});
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('#reading-options summary').click();
  await page.locator('#scroll-read').check();
  await page.locator('#reading-options summary').click();
  const y = await card.evaluate(node => scrollY + node.getBoundingClientRect().bottom + 2);
  await page.evaluate(y => scrollTo(0, y), y);
  await expect(card.locator('.read-button')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => card.locator('.story-copy').evaluate(node => getComputedStyle(node, '::before').borderInlineStartWidth)).toBe('4px');
  expect(Math.abs(await page.evaluate(() => scrollY) - y)).toBeLessThan(1);
});

test('article rows adapt to their available width and preserve full metadata and touch targets', async ({page}) => {
  await load(page);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({width, height:900});
    await waitForHeaderTransitions(page);
    await noHorizontalOverflow(page, 'html');
    for (const card of await page.locator('.article-card').all()) {
      expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      const byline = await card.locator('.article-attribution').boundingBox(), dates = await card.locator('.story-dates').boundingBox();
      expect(dates.y).toBeGreaterThanOrEqual(byline.y + byline.height);
      for (const target of await card.locator('button,a').all()) {
        const box = await target.boundingBox();
        // Browser geometry can report a 44px target a fraction of a pixel short.
        expect(box.height).toBeGreaterThanOrEqual(44 - 0.001);
        expect(box.width).toBeGreaterThanOrEqual(44 - 0.001);
      }
    }
    const card = page.locator('.article-card').first();
    const links = await card.locator('.story-foot').boundingBox(), actions = await card.locator('.story-actions').boundingBox();
    if (width >= 768) expect(Math.abs(links.y - actions.y)).toBeLessThan(1);
    else expect(actions.y).toBeGreaterThanOrEqual(links.y + links.height);
    await expect(card.locator('.story-dates time')).toHaveCount(2);
  }
  const missing = page.locator('.article-card').filter({hasText:headlines[2]});
  await expect(missing.locator('.excerpt')).toHaveCount(0);
  await expect(missing.locator('.story-dates')).toHaveText('No date in feed');
  await missing.locator('.story-title').click();
  await expect(page.locator('.article-content')).toContainText('only a headline');
});

test('preview leads with the full title and keeps Save and Close reachable while reading', async ({page}) => {
  await load(page);
  const headline = page.locator('.story-title').nth(1);
  await headline.click();
  const dialog = page.locator('#article-dialog'), body = dialog.locator('#article-body'), save = dialog.locator('.article-dialog-actions .save-button'), close = dialog.getByRole('button', {name:'Close story'});
  await expect(dialog).toHaveAccessibleName(headlines[1]);
  await expect(dialog.locator('#article-title')).toBeFocused();
  await expect(dialog.locator('.article-links .save-button')).toHaveCount(0);
  for (const size of [{width:1440,height:900}, {width:390,height:844}, {width:320,height:568}, {width:760,height:360}]) {
    await page.setViewportSize(size);
    await body.evaluate(node => node.scrollTop = 0);
    await expect.poll(async () => {
      const frame = await dialog.boundingBox(), title = await dialog.locator('#article-title').boundingBox();
      return title.y - frame.y < 110 && title.width > Math.min(frame.width - 80, 600);
    }).toBe(true);
    await expect(save).toBeInViewport();
    await expect(close).toBeInViewport();
    const controls = await dialog.locator('.article-dialog-actions').boundingBox();
    await body.evaluate(node => node.scrollTop = node.scrollHeight);
    expect(await dialog.locator('.article-dialog-actions').boundingBox()).toEqual(controls);
    await expect(save).toBeInViewport();
    await expect(close).toBeInViewport();
    await noHorizontalOverflow(page, '#article-dialog');
    await noHorizontalOverflow(page, '#article-body');
  }
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(save).toHaveAttribute('aria-pressed', 'true');
  await expect(save).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(headline).toBeFocused();
  await expect(page.locator('.article-card .save-button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await headline.click();
  expect(await body.evaluate(node => node.scrollTop)).toBe(0);
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(headline).toBeFocused();
});

test('expanded text and long attribution reflow while preview links stay clear of its controls', async ({page}) => {
  await load(page);
  await page.setViewportSize({width:320,height:568});
  // Use the real DOM to stress arbitrary publisher names without changing catalog verification.
  await page.locator('.article-card .publisher').first().evaluate(node => node.textContent = 'The Greater Seattle Neighborhoods and Regional Transportation Review');
  const stylesheet = new URL('./article-test-spacing.css', page.url()).href;
  await page.route(stylesheet, route => route.fulfill({contentType:'text/css',body:'html {font-size:200%!important} :is(.article-card,.article-preview) * {line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important} :is(.article-card,.article-preview) p {margin-bottom:2em!important}'}));
  await page.addStyleTag({url:stylesheet});
  await expect(page.locator('html')).toHaveCSS('font-size', '32px');
  await noHorizontalOverflow(page, 'html');
  await expect(page.locator('.story-title').first()).toBeVisible();
  await page.locator('.story-title').first().click();
  await noHorizontalOverflow(page, '#article-dialog');
  await noHorizontalOverflow(page, '#article-body');
  await expect(page.locator('.article-content')).toContainText(paragraph);
  for (const link of await page.locator('#article-body a').all()) {
    await link.focus();
    await expect(link).toBeInViewport();
    await expect.poll(async () => {
      const body = await page.locator('#article-body').boundingBox(), controls = await page.locator('.article-dialog-actions').boundingBox(), box = await link.boundingBox();
      if (box.height > body.height) return box.y >= controls.y + controls.height - 1 && box.y < body.y + body.height;
      return box.y >= controls.y + controls.height - 1 && box.y + box.height <= body.y + body.height + 1;
    }).toBe(true);
  }
  await expect(page.locator('#article-dialog .close-button')).toBeInViewport();
  await expect(page.locator('#article-save .save-button')).toBeInViewport();
});

test('article fonts load locally with real italics and external destinations wait for activation', async ({page}) => {
  const fonts = [], external = [];
  page.on('request', request => {
    if (request.resourceType() === 'font') fonts.push(request.url());
    if (/^https:\/\/(?:publisher\.example|ghostarchive\.org)/.test(request.url())) external.push(request.url());
  });
  await load(page);
  await page.locator('.story-title').first().click();
  await page.evaluate(() => document.fonts.ready);
  expect(fonts.some(url => url.includes('source-serif-4-latin-normal'))).toBe(true);
  expect(fonts.some(url => url.includes('source-serif-4-latin-italic'))).toBe(true);
  await expect(page.locator('#article-dialog .article-metadata')).toHaveCSS('font-family', /system-ui/);
  for (const url of fonts) expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  expect(external).toHaveLength(0);
  await expect(page.locator('.article-content em')).toHaveCSS('font-style', 'italic');
  await expect(page.locator('.article-content')).toHaveCSS('font-synthesis', 'none');
  const popup = page.waitForEvent('popup');
  await page.context().route('https://publisher.example/**', route => route.fulfill({contentType:'text/html',body:'<h1>Publisher</h1>'}));
  await page.locator('#article-dialog .publisher-link').first().click();
  await (await popup).close();
  await page.keyboard.press('Escape');
  await expect(page.locator('.article-card .read-button').first()).toHaveAttribute('aria-pressed', 'true');
});

test('font failure and forced colors retain readable articles and explicit states', async ({page}) => {
  await page.route('**/*.woff2', route => route.abort());
  await load(page);
  await page.locator('#reading-options summary').click();
  await page.locator('#scroll-read').uncheck();
  await page.locator('#reading-options summary').click();
  await page.emulateMedia({forcedColors:'active', reducedMotion:'reduce'});
  await page.setViewportSize({width:320,height:568});
  await noHorizontalOverflow(page, 'html');
  const card = page.locator('.article-card').first();
  await card.locator('.save-button').click();
  await card.locator('.read-button').click();
  await expect(card.locator('.read-button')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => card.locator('.story-copy').evaluate(node => getComputedStyle(node, '::before').borderInlineStartStyle)).toBe('solid');
  await expect(card.locator('.save-button')).toHaveAttribute('aria-pressed', 'true');
  await card.locator('.story-title').click();
  await expect(page.locator('.article-content')).toContainText(paragraph);
  await noHorizontalOverflow(page, '#article-dialog');
  await page.keyboard.press('Escape');
  await expect(card.locator('.story-title')).toBeFocused();
});

test('switching from articles to posts offers source links without previews', async ({page}) => {
  await load(page);
  await page.locator('.story-title').first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#article-dialog')).toBeHidden();
  await expect(page).not.toHaveURL(/article=/);
  const feed = catalog.feeds.find(item => item.category === 'bluesky');
  await page.goto(`./#source=${feed.id}`);
  await expect(page.locator('.post')).toHaveCount(3);
  await expect(page.locator('.article-card')).toHaveCount(0);
  await expect(page.locator('.preview-post')).toHaveCount(0);
  await expect(page.locator('.post a.post-text')).toHaveCount(3);
  await expect(page.locator('#article-dialog')).toBeHidden();
});
