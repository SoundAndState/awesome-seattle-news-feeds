import fs from 'node:fs/promises';
import {root, read, loadCatalog, validateCatalog} from './catalog.mjs';
import {renderReadme, renderOpml, renderImportReview} from './render.mjs';

const catalog = await validateCatalog(await loadCatalog());
const outputs = {'readme.md': renderReadme(catalog), 'feeds.opml': renderOpml(catalog), 'docs/import-review.md': renderImportReview(catalog)};
for (const [path, content] of Object.entries(outputs)) {
  if (process.argv.includes('--check')) {
    const actual = await read(path).catch(() => '');
    if (actual !== content) throw new Error(`${path} is stale or missing. Run npm run build and commit the results.`);
  } else {
    await fs.mkdir(new URL('docs/', root), {recursive: true});
    await fs.writeFile(new URL(path, root), content);
  }
}
console.log(`${process.argv.includes('--check') ? 'Checked' : 'Built'} README, OPML, and import review from ${catalog.feeds.length} feeds.`);
