import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeSiteConfig} from '../web/src/site-config.mjs';
import {normalizeCatalog} from '../web/src/catalog.mjs';
import {validateCatalog} from '../scripts/catalog.mjs';

const defaultPath = fileURLToPath(new URL('./site.config.json', import.meta.url));
const defaultCatalog = fileURLToPath(new URL('../data/feeds.json', import.meta.url));

export async function loadReaderConfig(configPath = process.env.READER_SITE_CONFIG || defaultPath) {
  const filename = path.resolve(configPath);
  const raw = JSON.parse(await fs.readFile(filename, 'utf8'));
  const site = normalizeSiteConfig(raw);
  if (filename !== defaultPath && site.storageNamespace === 'sound-and-state') throw new Error('Alternate sites must set their own storageNamespace to keep browser libraries separate.');
  if (typeof raw.catalog !== 'string' || !raw.catalog.trim()) throw new Error('Reader site configuration requires a catalog file path.');
  const catalogPath = path.resolve(path.dirname(filename), raw.catalog);
  const source = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  // The Seattle publishing pipeline keeps its richer editorial constraints.
  if (catalogPath === defaultCatalog) await validateCatalog(source);
  const catalog = normalizeCatalog(source);
  return {
    site, catalog, catalogPath, opmlCatalog: catalogPath === defaultCatalog ? source : catalog,
    publicDir: raw.publicDir ? path.resolve(path.dirname(filename), raw.publicDir) : fileURLToPath(new URL('../web/public', import.meta.url)),
    origins: [...new Set([site.proxy, ...catalog.feeds.flatMap(feed => [feed.feed, ...feed.redirects])].filter(Boolean).map(url => new URL(url).origin))].sort(),
  };
}
