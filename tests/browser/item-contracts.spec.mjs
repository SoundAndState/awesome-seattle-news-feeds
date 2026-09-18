import {test, expect, browserCatalog, loadReader} from './fixtures.mjs';
import {makeSource} from '../fixtures/catalog.mjs';
import {contractFormats, contractFeed} from '../fixtures/source-contracts.mjs';
import {unsafeHtml} from '../fixtures/feeds.mjs';

const catalog = browserCatalog({feeds: contractFormats.map(format => makeSource({id: `contract-${format}`, format, kind: 'articles', name: `Publisher ${format}`}))});
const bodies = Object.fromEntries(catalog.feeds.map(source => [source.id, contractFeed(source.format, {
  title: `Reporting from ${source.format}`, url: `https://publisher.example/${source.format}`, html: unsafeHtml,
})]));
test.use({readerCatalog: catalog, feedBodies: bodies});

test('all source adapters share safe rendering and durable saved items', async ({page}) => {
  await loadReader(page, {catalog, bodies});
  for (const source of catalog.feeds) {
    const story = page.locator('.story').filter({hasText: `Reporting from ${source.format}`});
    await story.locator('.save-button').click();
    await story.locator('.story-title').click();
    const content = page.locator('.article-content');
    await expect(content).toContainText('A new trail connects two neighborhoods.');
    await expect(content.locator('script,img')).toHaveCount(0);
    await expect(content.getByText('Unsafe link')).not.toHaveAttribute('href');
    await expect(content.getByText('More reporting')).toHaveAttribute('href', 'https://publisher.example/more');
    expect(await page.evaluate(() => window.compromised)).toBeUndefined();
    await page.getByRole('button', {name: 'Close story', exact: true}).click();
    await expect(page.locator('#article-dialog')).toBeHidden();
  }
  await expect(page.locator('#saved-count')).toHaveText('4');
  await page.reload();
  await page.locator('#saved-button').click();
  await expect(page.locator('.story')).toHaveCount(4);
  await expect(page.locator('.story.is-read')).toHaveCount(4);
  for (const source of catalog.feeds) await expect(page.locator('.story').filter({hasText: `Reporting from ${source.format}`})).toContainText(source.name);
});
