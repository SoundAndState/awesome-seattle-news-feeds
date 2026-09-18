import defaultConfig from '../../config/site.config.json' with {type: 'json'};
import {httpsUrl, feedServiceUrl} from './catalog.mjs';

function localAsset(value, fallback) {
  const path = value ?? fallback;
  if (typeof path !== 'string' || !path || /[\\\s<>"'`?#]/.test(path) || path.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.split('/').includes('..')) throw new Error('Brand assets must use paths on this website.');
  return path;
}

export function normalizeSiteConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Reader site configuration must be an object.');
  const requiredText = key => {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 2000) throw new Error(`Reader site configuration requires ${key}.`);
    return value[key].trim();
  };
  const name = requiredText('name');
  const namespace = requiredText('storageNamespace');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(namespace) || namespace.length > 100) throw new Error('storageNamespace must be a short lowercase identifier.');
  const base = value.base ?? '/';
  if (typeof base !== 'string' || !/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error('base must be a website path beginning and ending with /.');
  const theme = value.theme ?? 'jade';
  if (!['jade', 'blue'].includes(theme)) throw new Error('theme must be jade or blue.');
  const capabilities = Object.fromEntries(['articles', 'posts', 'archive', 'backups'].map(key => {
    const enabled = value.capabilities?.[key] ?? (key !== 'archive');
    if (typeof enabled !== 'boolean') throw new Error(`capabilities.${key} must be a boolean.`);
    return [key, enabled];
  }));
  if (!capabilities.articles && !capabilities.posts) throw new Error('Enable at least one reading mode.');
  return {
    name, title: requiredText('title'), description: requiredText('description'),
    tagline: typeof value.tagline === 'string' ? value.tagline.slice(0, 500) : '',
    homeLabel: typeof value.homeLabel === 'string' ? value.homeLabel : `${name} home`,
    url: httpsUrl(value.url, 'site URL'), base,
    proxy: value.proxy ? feedServiceUrl(value.proxy) : '',
    repository: value.repository ? httpsUrl(value.repository, 'repository URL') : '',
    storageNamespace: namespace, theme, capabilities,
    categoryLabels: Object.fromEntries(Object.entries(value.categoryLabels || {}).filter(([key, label]) => /^[a-z0-9-]+$/.test(key) && typeof label === 'string').map(([key, label]) => [key, label.slice(0, 200)])),
    assets: {logo: localAsset(value.assets?.logo, './favicon.svg'), socialImage: localAsset(value.assets?.socialImage, './social-card.png')},
    about: Object.fromEntries(['purpose', 'hosting', 'serviceDetails', 'delivery', 'cache', 'snapshots'].map(key => [key, typeof value.about?.[key] === 'string' ? value.about[key].slice(0, 5000) : ''])),
    catalogUrl: 'catalog.json', opmlUrl: value.opmlUrl === null ? null : 'feeds.opml',
  };
}

export const site = normalizeSiteConfig(typeof __READER_CONFIG__ === 'undefined' ? defaultConfig : __READER_CONFIG__);
