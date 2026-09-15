import {XMLParser} from 'fast-xml-parser';
import {loadCatalog, validateCatalog, read} from './catalog.mjs';

const catalog = await validateCatalog(await loadCatalog());
const source = new XMLParser({ignoreAttributes: false, attributeNamePrefix: ''}).parse(await read('reference/feedly-export.opml'));
const urls = [];
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (value.xmlUrl) urls.push(value.xmlUrl);
  for (const child of Object.values(value)) if (typeof child === 'object') visit(child);
}
visit(source);
const reviewed = catalog.imports.map(entry => entry.url).sort();
if (JSON.stringify(urls.sort()) !== JSON.stringify(reviewed)) throw new Error('Every original subscription must have exactly one import decision.');
console.log(`Validated JSON schema, categories, URL uniqueness, aliases, and all ${urls.length} import decisions.`);
