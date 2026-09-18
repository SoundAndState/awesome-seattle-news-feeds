import {SOURCE_FORMATS} from './source-model.mjs';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FORMATS = new Set(SOURCE_FORMATS);

function text(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`The feed list has an invalid ${label}.`);
  return value.trim();
}

export function httpsUrl(value, label = 'URL') {
  const input = text(value, label, 4096);
  let url;
  try {url = new URL(input);} catch {throw new Error(`The feed list has an invalid ${label}.`);}
  if (url.protocol !== 'https:' || url.username || url.password || /[\s<>"'`]/.test(input)) throw new Error(`The feed list requires an HTTPS ${label} without credentials.`);
  // Validate without rewriting the exact destination authorized by the catalog.
  return input;
}

export function feedServiceUrl(value) {
  const url = httpsUrl(value, 'feed service URL');
  // A service address is a base path for /feed/{id}, not an individual request.
  // Reject even empty query/fragment delimiters, which would swallow that path.
  if (/[?#]/.test(url)) throw new Error('The feed service URL must not contain a query or fragment.');
  return url.replace(/\/$/, '');
}

function id(value, label) {
  if (typeof value !== 'string' || value.length > 120 || !ID.test(value)) throw new Error(`The feed list has an invalid ${label}.`);
  return value;
}

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`The feed list has duplicate ${label}.`);
}

// The public reader contract is intentionally independent of the Seattle
// editorial schema (health checks, contribution notes, and README sections).
export function normalizeCatalog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.categories) || !Array.isArray(value.feeds)) throw new Error('The reader could not read the feed list.');
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) throw new Error('The reader does not support this feed-list version.');
  if (!value.categories.length || value.categories.length > 1000 || !value.feeds.length || value.feeds.length > 5000) throw new Error('The feed list must contain categories and between 1 and 5,000 sources.');
  const categories = value.categories.map(category => {
    if (!category || typeof category !== 'object') throw new Error('The feed list has an invalid category.');
    return {id: id(category.id, 'category ID'), title: text(category.title, 'category title'), description: typeof category.description === 'string' ? category.description.slice(0, 5000) : '', ...(typeof category.label === 'string' ? {label: category.label.slice(0, 200)} : {})};
  });
  unique(categories.map(category => category.id), 'category IDs');
  const categoryIds = new Set(categories.map(category => category.id));
  const feeds = value.feeds.map(feed => {
    if (!feed || typeof feed !== 'object') throw new Error('The feed list has an invalid source.');
    const category = id(feed.category, 'source category');
    if (!categoryIds.has(category)) throw new Error(`The feed list has an unknown category: ${category}.`);
    const kind = feed.kind ?? (category === 'bluesky' ? 'posts' : 'articles');
    if (!['articles', 'posts'].includes(kind)) throw new Error('A source must contain articles or posts.');
    const format = typeof feed.format === 'string' ? feed.format.toLowerCase() : 'auto';
    if (!FORMATS.has(format)) throw new Error(`The reader does not support the feed format: ${format}.`);
    if (feed.redirects !== undefined && (!Array.isArray(feed.redirects) || feed.redirects.length > 20)) throw new Error('The feed list has invalid redirect destinations.');
    return {
      id: id(feed.id, 'source ID'), name: text(feed.name, 'source name'),
      website: httpsUrl(feed.website, 'source website'), feed: httpsUrl(feed.feed, 'feed address'),
      category, description: typeof feed.description === 'string' ? feed.description.slice(0, 5000) : '',
      kind, format, platform: typeof feed.platform === 'string' ? feed.platform.slice(0, 100) : category === 'bluesky' ? 'Bluesky' : '',
      redirects: (feed.redirects || []).map(url => httpsUrl(url, 'redirect address')),
    };
  });
  unique(feeds.map(feed => feed.id), 'source IDs');
  unique(feeds.map(feed => feed.feed), 'feed addresses');
  return {schemaVersion: 1, title: text(value.title, 'title'), repository: typeof value.repository === 'string' ? value.repository.slice(0, 4096) : '', categories, feeds};
}
