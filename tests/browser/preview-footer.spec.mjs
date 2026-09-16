import {test, expect} from '@playwright/test';

test('preview repeats publisher and archive links only for at least 220 characters of content', async ({page}) => {
  const lengths = [0, 219, 220, 500];
  const xml = `<rss version="2.0"><channel><title>Publisher</title>${lengths.map(length => `<item><title>Preview ${length}</title><link>https://publisher.example/article-${length}</link><description><![CDATA[<p>   <strong>${'x'.repeat(length)}</strong>   </p>]]></description></item>`).join('')}</channel></rss>`;
  await page.route('https://awesome-seattle-feed-proxy.bmenesini.workers.dev/feed/*', route => route.fulfill({contentType:'application/xml', body:xml}));
  await page.goto('./#source=seattle-transit-blog');
  await expect(page.locator('#refresh')).toBeEnabled();
  for (const length of lengths) {
    await page.getByRole('button', {name:`Preview article: Preview ${length}`, exact:true}).click();
    const top = page.locator('#article-body > .article-links');
    const footer = page.locator('.article-preview-footer');
    await expect(top.getByRole('link', {name:/Read at publisher/})).toBeVisible();
    await expect(top.getByRole('link', {name:/Find archived page/})).toBeVisible();
    await expect(footer.getByRole('link')).toHaveCount(length >= 220 ? 2 : 0);
    await expect(footer.locator('.feed-note')).toBeVisible();
    await page.keyboard.press('Escape');
  }
});
