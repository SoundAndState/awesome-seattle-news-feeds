import {messages, formatMessage} from './localization.mjs';
import {SOURCE_FORMATS} from './source-model.mjs';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FORMATS = new Set(SOURCE_FORMATS);

function text(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(formatMessage(messages.catalog.invalidField, {label: label}));
  return value.trim();
}

export function httpsUrl(value, label = messages.common.url) {
  const input = text(value, label, 4096);
  let url;
  try {url = new URL(input);} catch {throw new Error(formatMessage(messages.catalog.invalidField, {label: label}));}
  if (url.protocol !== 'https:' || url.username || url.password || /[\s<>"'`]/.test(input)) throw new Error(formatMessage(messages.catalog.invalidUrl, {label: label}));
  // Validate without rewriting the exact destination authorized by the catalog.
  return input;
}

export function feedServiceUrl(value) {
  const url = httpsUrl(value, messages.catalog.feedServiceURL);
  // A service address is a base path for /feed/{id}, not an individual request.
  // Reject even empty query/fragment delimiters, which would swallow that path.
  if (/[?#]/.test(url)) throw new Error(messages.catalog.invalidServiceUrl);
  return url.replace(/\/$/, '');
}

function id(value, label) {
  if (typeof value !== 'string' || value.length > 120 || !ID.test(value)) throw new Error(formatMessage(messages.catalog.invalidField, {label: label}));
  return value;
}

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(formatMessage(messages.catalog.duplicates, {label: label}));
}

// The public reader contract is intentionally independent of the Seattle
// editorial schema (health checks, contribution notes, and README sections).
export function normalizeCatalog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.categories) || !Array.isArray(value.feeds)) throw new Error(messages.catalog.invalid);
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) throw new Error(messages.catalog.unsupportedVersion);
  if (!value.categories.length || value.categories.length > 1000 || !value.feeds.length || value.feeds.length > 5000) throw new Error(messages.catalog.invalidSize);
  const categories = value.categories.map(category => {
    if (!category || typeof category !== 'object') throw new Error(messages.catalog.invalidCategory);
    return {id: id(category.id, messages.catalog.categoryID), title: text(category.title, messages.catalog.categoryTitle), description: typeof category.description === 'string' ? category.description.slice(0, 5000) : '', ...(typeof category.label === 'string' ? {label: category.label.slice(0, 200)} : {})};
  });
  unique(categories.map(category => category.id), messages.catalog.categoryIDs);
  const categoryIds = new Set(categories.map(category => category.id));
  const feeds = value.feeds.map(feed => {
    if (!feed || typeof feed !== 'object') throw new Error(messages.catalog.invalidSource);
    const category = id(feed.category, messages.catalog.sourceCategory);
    if (!categoryIds.has(category)) throw new Error(formatMessage(messages.catalog.unknownCategory, {category: category}));
    const kind = feed.kind ?? (category === 'bluesky' ? 'posts' : 'articles');
    if (!['articles', 'posts'].includes(kind)) throw new Error(messages.catalog.invalidKind);
    const format = typeof feed.format === 'string' ? feed.format.toLowerCase() : 'auto';
    if (!FORMATS.has(format)) throw new Error(formatMessage(messages.catalog.unsupportedFormat, {format: format}));
    if (feed.redirects !== undefined && (!Array.isArray(feed.redirects) || feed.redirects.length > 20)) throw new Error(messages.catalog.invalidRedirects);
    return {
      id: id(feed.id, messages.catalog.sourceID), name: text(feed.name, messages.catalog.sourceName),
      website: httpsUrl(feed.website, messages.catalog.sourceWebsite), feed: httpsUrl(feed.feed, messages.network.feedAddress),
      category, description: typeof feed.description === 'string' ? feed.description.slice(0, 5000) : '',
      kind, format, platform: typeof feed.platform === 'string' ? feed.platform.slice(0, 100) : category === 'bluesky' ? 'Bluesky' : '',
      redirects: (feed.redirects || []).map(url => httpsUrl(url, messages.catalog.redirectAddress)),
    };
  });
  unique(feeds.map(feed => feed.id), messages.catalog.sourceIDs);
  unique(feeds.map(feed => feed.feed), messages.catalog.feedAddresses);
  return {schemaVersion: 1, title: text(value.title, messages.catalog.titleField), repository: typeof value.repository === 'string' ? value.repository.slice(0, 4096) : '', categories, feeds};
}
