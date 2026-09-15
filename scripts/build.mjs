import fs from 'node:fs/promises';
import {root, read, loadCatalog, validateCatalog} from './catalog.mjs';
import {renderReadme, renderOpml} from './render.mjs';

const catalog = await validateCatalog(await loadCatalog());
const outputs = {'readme.md': renderReadme(catalog), 'feeds.opml': renderOpml(catalog)};
for (const [path, content] of Object.entries(outputs)) {
  if (process.argv.includes('--check')) {
    const actual = await read(path).catch(() => '');
    if (actual !== content) throw new Error(`${path} is stale or missing. Run npm run build; GitHub Actions also regenerates it.`);
  } else {
    await fs.writeFile(new URL(path, root), content);
  }
}
console.log(`${process.argv.includes('--check') ? 'Checked' : 'Built'} README and OPML from ${catalog.feeds.length} feeds.`);
