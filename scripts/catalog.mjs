import fs from 'node:fs/promises';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export const root = new URL('../', import.meta.url);
export const read = path => fs.readFile(new URL(path, root), 'utf8');
export const loadCatalog = async () => JSON.parse(await read('feeds.json'));

// Deliberately conservative: query values and path case can identify distinct feeds.
export function canonicalUrl(value) {
  const url = new URL(value.trim().replace(/(?:%20)+$/gi, ''));
  url.protocol = 'https:';
  url.hostname = url.hostname.replace(/^www\./, '');
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  url.searchParams.sort();
  return url.href;
}

export async function validateCatalog(catalog) {
  const ajv = new Ajv({allErrors: true});
  addFormats(ajv);
  const schema = JSON.parse(await read('feeds.schema.json'));
  if (!ajv.validate(schema, catalog)) throw new Error(ajv.errorsText(ajv.errors, {separator: '\n'}));
  const seen = new Map();
  const unique = (kind, value, owner = value) => {
    const key = `${kind}:${value}`;
    if (seen.has(key)) throw new Error(`Duplicate ${kind}: ${value} (${seen.get(key)} and ${owner})`);
    seen.set(key, owner);
  };
  const categories = new Set(catalog.categories.map(category => category.id));
  for (const category of catalog.categories) {
    unique('category', category.id);
    unique('heading', category.title.toLowerCase());
  }
  for (const section of catalog.sections) unique('heading', section.title.toLowerCase());
  for (const feed of catalog.feeds) {
    unique('id', feed.id);
    unique('name', feed.name.toLowerCase());
    if (!categories.has(feed.category)) throw new Error(`Unknown category: ${feed.category}`);
    for (const url of [feed.feed, ...feed.aliases]) unique('feed URL', canonicalUrl(url), feed.id);
  }
  for (const category of categories) {
    if (!catalog.feeds.some(feed => feed.category === category)) throw new Error(`Empty category: ${category}`);
  }
  return catalog;
}

export const sortedFeeds = (catalog, category) => catalog.feeds
  .filter(feed => feed.category === category)
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));
export const slug = text => text.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
export const markdown = text => text.replace(/[\\`*_[\]<>]/g, '\\$&');
export const xml = text => text.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[char]));
export const link = url => url.replace(/\/$/, '');
