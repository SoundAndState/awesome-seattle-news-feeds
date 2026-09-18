import {readFile} from 'node:fs/promises';
import {test, expect, loadReader, openMenu, readStoredLibrary, catalog} from './fixtures.mjs';
import {normalizeFeed} from '../../web/src/feeds.mjs';
import {prepareItem} from '../../web/src/item-model.mjs';
import {contractFeed, contractNow} from '../fixtures/source-contracts.mjs';
import {NOW} from '../fixtures/feeds.mjs';

const body = prepareItem({...normalizeFeed(contractFeed('rss', {url: 'https://publisher.example/restored', title: 'Restored reporting'}), catalog.feeds[0], contractNow)[0], sourceName: catalog.feeds[0].name}, String);
const backup = {format: 'sound-and-state', version: 1, collection: 'sound-and-state', state: [{id: body.id, saved: true, read: true}], savedArticles: [body]};
const upload = data => ({name: 'library.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data))});

test('two tabs preserve independent read/save changes and reconcile Saved without fetching feeds', async ({page, context}) => {
  await loadReader(page);
  const id = await page.locator('.story').first().getAttribute('data-article');
  const second = await context.newPage();
  await second.clock.install({time: NOW});
  await second.goto('./#view=all');
  const story = target => target.locator('.story').filter({has: target.locator(`[data-save="${id}"]`)});
  await expect(story(second)).toBeVisible();
  await story(page).locator('.save-button').click();
  await expect(page.locator('#saved-count')).toHaveText('1');
  await story(second).locator('.read-button').click();
  await expect(story(second)).toHaveClass(/is-read/);
  await expect(second.locator('#saved-count')).toHaveText('1');
  await story(page).locator('.save-button').click();
  await expect(page.locator('#saved-count')).toHaveText('0');
  const stored = await readStoredLibrary(page);
  expect(stored.state.find(item => item.id === id)).toMatchObject({saved: false, read: true});
  await second.locator('#saved-button').click();
  await second.clock.fastForward(60000);
  await expect(second.locator('#saved-count')).toHaveText('0');
  await expect(second.locator('.story')).toHaveCount(0);
  await second.close();
});

test('an interrupted import rolls back disk, remains exportable during the visit, and does not partly survive reload', async ({page}) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) {
      if (window.failImportedMark && this.name === 'state' && value.id === 'https://publisher.example/restored') throw new DOMException('Fixture write interruption', 'QuotaExceededError');
      return put.call(this, value, ...args);
    };
  });
  await loadReader(page);
  await page.evaluate(() => {window.failImportedMark = true;});
  await openMenu(page); await page.locator('#about-button').click();
  await page.locator('#backup-file').setInputFiles(upload(backup));
  await expect(page.locator('#backup-status')).toContainText('combined 1 saved items');
  await expect(page.locator('#saved-count')).toHaveText('1');
  const stored = await readStoredLibrary(page);
  expect(stored.articles.some(item => item.id === body.id)).toBe(false);
  expect(stored.state.some(item => item.id === body.id)).toBe(false);
  const downloading = page.waitForEvent('download');
  await page.locator('#export-state').click();
  const exported = JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
  expect(exported.savedArticles.map(item => item.id)).toContain(body.id);
  await page.getByRole('button', {name: 'Close about', exact: true}).click();
  await expect(page.locator('#notice')).toContainText('cannot save changes');
  await page.reload();
  await expect(page.locator('#heading')).toContainText('articles');
  await expect(page.locator('#saved-count')).toHaveText('0');
});

test('a backup from another collection is rejected before changing the current library', async ({page}) => {
  await loadReader(page);
  await page.locator('.save-button').first().click();
  await expect(page.locator('#saved-count')).toHaveText('1');
  const before = await readStoredLibrary(page);
  await openMenu(page); await page.locator('#about-button').click();
  await page.locator('#backup-file').setInputFiles(upload({...backup, collection: 'another-local-collection'}));
  await expect(page.locator('#backup-status')).toContainText('another collection');
  const after = await readStoredLibrary(page);
  expect(after.state).toEqual(before.state);
  expect(after.articles).toEqual(before.articles);
});

test('a released version-one browser library upgrades with its saved article and marks intact', async ({page}) => {
  // Seed the old physical IndexedDB version on this origin before React opens it.
  await page.goto('./third-party-notices.txt');
  await page.evaluate(async item => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sound-and-state', 10);
      request.onupgradeneeded = () => {
        const articles = request.result.createObjectStore('articles', {keyPath: 'id'});
        articles.createIndex('published', 'published'); articles.createIndex('firstSeen', 'firstSeen'); articles.createIndex('feedIds', 'feedIds', {multiEntry: true});
        request.result.createObjectStore('state', {keyPath: 'id'}); request.result.createObjectStore('feeds', {keyPath: 'id'});
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['articles', 'state'], 'readwrite');
      tx.objectStore('articles').put(item); tx.objectStore('state').put({id: item.id, saved: true, read: true});
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, body);
  await page.goto('./#view=saved');
  await expect(page.locator('.story')).toHaveCount(1);
  await expect(page.locator('.story')).toContainText(body.title);
  await expect(page.locator('.story')).toHaveClass(/is-read/);
  const stored = await readStoredLibrary(page);
  expect(stored.state).toEqual(backup.state);
  expect(stored.settings.some(item => item.id === 'catalog')).toBe(true);
  await page.reload();
  await expect(page.locator('.story')).toHaveCount(1);
});
