import {messages, formatMessage} from './localization.mjs';
import defaultConfig from '../../config/site.config.json' with {type: 'json'};
import {httpsUrl, feedServiceUrl} from './catalog.mjs';

function localAsset(value, fallback) {
  const path = value ?? fallback;
  if (typeof path !== 'string' || !path || /[\\\s<>"'`?#]/.test(path) || path.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.split('/').includes('..')) throw new Error(messages.configuration.invalidAsset);
  return path;
}

export function normalizeSiteConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(messages.configuration.invalid);
  if (value.copy === 'en') value = {...messages.site, ...value};
  const requiredText = key => {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 2000) throw new Error(formatMessage(messages.configuration.required, {key: key}));
    return value[key].trim();
  };
  const name = requiredText('name');
  const namespace = requiredText('storageNamespace');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(namespace) || namespace.length > 100) throw new Error(messages.configuration.invalidNamespace);
  const base = value.base ?? '/';
  if (typeof base !== 'string' || !/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error(messages.configuration.invalidBase);
  const theme = value.theme ?? 'jade';
  if (!['jade', 'blue'].includes(theme)) throw new Error(messages.configuration.invalidTheme);
  const capabilities = Object.fromEntries(['articles', 'posts', 'archive', 'backups'].map(key => {
    const enabled = value.capabilities?.[key] ?? (key !== 'archive');
    if (typeof enabled !== 'boolean') throw new Error(formatMessage(messages.configuration.invalidCapability, {key: key}));
    return [key, enabled];
  }));
  if (!capabilities.articles && !capabilities.posts) throw new Error(messages.configuration.noMode);
  return {
    name, title: requiredText('title'), description: requiredText('description'),
    tagline: typeof value.tagline === 'string' ? value.tagline.slice(0, 500) : '',
    homeLabel: typeof value.homeLabel === 'string' ? value.homeLabel : formatMessage(messages.configuration.homeLabel, {name: name}),
    url: httpsUrl(value.url, messages.configuration.siteURL), base,
    proxy: value.proxy ? feedServiceUrl(value.proxy) : '',
    repository: value.repository ? httpsUrl(value.repository, messages.configuration.repositoryURL) : '',
    storageNamespace: namespace, theme, capabilities,
    categoryLabels: Object.fromEntries(Object.entries(value.categoryLabels || {}).filter(([key, label]) => /^[a-z0-9-]+$/.test(key) && typeof label === 'string').map(([key, label]) => [key, label.slice(0, 200)])),
    assets: {logo: localAsset(value.assets?.logo, './favicon.svg'), socialImage: localAsset(value.assets?.socialImage, './social-card.png')},
    about: Object.fromEntries(['purpose', 'hosting', 'serviceDetails', 'delivery', 'cache', 'snapshots'].map(key => [key, typeof value.about?.[key] === 'string' ? value.about[key].slice(0, 5000) : ''])),
    catalogUrl: 'catalog.json', opmlUrl: value.opmlUrl === null ? null : 'feeds.opml',
  };
}

export const site = normalizeSiteConfig(typeof __READER_CONFIG__ === 'undefined' ? defaultConfig : __READER_CONFIG__);
