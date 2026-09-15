import {loadCatalog, validateCatalog} from './catalog.mjs';

const catalog = await validateCatalog(await loadCatalog());
console.log(`Validated JSON schema, categories, URL uniqueness, and aliases for ${catalog.feeds.length} feeds.`);
