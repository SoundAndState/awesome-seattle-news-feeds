import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFeed} from '../web/src/feeds.mjs';
import {dateLabel, dateIso} from '../web/src/dates.mjs';

const source = {id:'example', website:'https://example.com'};
const now = Date.parse('2026-09-15T20:00:00Z');
const published = '2026-09-14T09:30:00-07:00', updated = '2026-09-15T12:45:00-07:00';
const rss = dates => `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><channel><title>News</title><description>Local news</description><lastBuildDate>${updated}</lastBuildDate><item><title>Story</title><link>https://example.com/story</link>${dates}</item></channel></rss>`;
const atom = dates => `<feed xmlns="http://www.w3.org/2005/Atom"><id>news</id><title>News</title><updated>${updated}</updated><entry><id>story</id><title>Story</title><link href="https://example.com/story"/>${dates}</entry></feed>`;

test('RSS extensions, Atom and JSON Feed retain independent publication and update times', () => {
  const feeds = [
    rss(`<pubDate>${published}</pubDate><atom:updated>${updated}</atom:updated>`),
    rss(`<dcterms:issued>${published}</dcterms:issued><dcterms:modified>${updated}</dcterms:modified>`),
    atom(`<published>${published}</published><updated>${updated}</updated>`),
    JSON.stringify({version:'https://jsonfeed.org/version/1.1',title:'News',items:[{id:'story',url:'https://example.com/story',content_text:'News',date_published:published,date_modified:updated}]}),
  ];
  for (const feed of feeds) {
    const [item] = normalizeFeed(feed, source, now);
    assert.equal(item.published, Date.parse(published));
    assert.equal(item.updated, Date.parse(updated));
    assert.equal(item.publishedDateOnly, false); assert.equal(item.updatedDateOnly, false);
  }
});

test('update-only items do not acquire a fictitious publication date; feed-level dates are ignored', () => {
  const [item] = normalizeFeed(atom(`<updated>${updated}</updated>`), source, now);
  assert.equal(item.published, 0); assert.equal(item.updated, Date.parse(updated));
  const [undated] = normalizeFeed(rss(''), source, now);
  assert.equal(undated.published, 0); assert.equal(undated.updated, 0);
});

test('invalid dates are skipped independently and implausible future dates are rejected', () => {
  const [item] = normalizeFeed(rss(`<pubDate>invalid</pubDate><dc:date>${published}</dc:date><atom:updated>2999-01-01T00:00:00Z</atom:updated>`), source, now);
  assert.equal(item.published, Date.parse(published)); assert.equal(item.updated, 0);
  const [updateOnly] = normalizeFeed(atom(`<published>invalid</published><updated>${updated}</updated>`), source, now);
  assert.equal(updateOnly.published, 0); assert.equal(updateOnly.updated, Date.parse(updated));
});

test('date-only values retain their calendar day and do not invent a time', () => {
  const [item] = normalizeFeed(rss('<dc:date>2026-09-14</dc:date><dcterms:modified>2026-09-15</dcterms:modified>'), source, now);
  assert.equal(item.publishedDateOnly, true); assert.equal(item.updatedDateOnly, true);
  assert.equal(dateLabel(item.published, true, true), 'Sep 14, 2026');
  assert.equal(dateIso(item.updated, true), '2026-09-15');
  assert.equal(dateLabel(0), 'No date in feed'); assert.equal(dateIso(Infinity), '');
  for (const timestamp of [Date.now(), Date.parse('2024-01-10T09:30:00Z')]) {
    assert.match(dateLabel(timestamp), /\b\d{4}\b/);
    assert.match(dateLabel(timestamp, true), /\b\d{4}\b/);
    assert.match(dateLabel(timestamp, true), /\d{1,2}:\d{2}/);
  }
});
