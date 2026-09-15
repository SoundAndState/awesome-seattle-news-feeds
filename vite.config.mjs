import {defineConfig} from 'vite';
import fs from 'node:fs/promises';
import {loadCatalog, validateCatalog} from './scripts/catalog.mjs';
import {renderOpml} from './scripts/render.mjs';
import config from './site.config.json' with {type: 'json'};

export default defineConfig({
  root: 'web',
  base: config.base,
  // Never load the repository's private Cloudflare .env into the frontend build.
  envDir: false,
  define: {__PROXY_URL__: JSON.stringify(config.proxy)},
  build: {outDir: '../dist', emptyOutDir: true},
  plugins: [{
    name: 'curated-catalog',
    async buildStart() {
      const catalog = await loadCatalog();
      await validateCatalog(catalog);
      this.emitFile({type: 'asset', fileName: 'catalog.json', source: JSON.stringify({
        title: catalog.title, repository: catalog.repository,
        categories: catalog.categories,
        feeds: catalog.feeds.map(({id, name, website, feed, category, description}) => ({id, name, website, feed, category, description})),
      })});
      this.emitFile({type: 'asset', fileName: 'feeds.opml', source: renderOpml(catalog)});
      let notices = 'Third-party software included in this reader\n\n';
      for (const pkg of ['feedsmith', 'dexie', 'dompurify', 'entities', 'feedsmith/node_modules/fast-xml-parser', 'strnum', 'fast-xml-builder', 'xml-naming', 'path-expression-matcher', 'is-unsafe', '@nodable/entities']) {
        const dir = `node_modules/${pkg}`;
        try {
          const metadata = JSON.parse(await fs.readFile(`${dir}/package.json`, 'utf8'));
          const files = await fs.readdir(dir);
          const license = files.find(name => /^licen[cs]e(?:\.txt|\.md|\.markdown)?$/i.test(name));
          const licensePath = license ? `${dir}/${license}` : pkg === '@nodable/entities' ? 'third-party/nodable-license.txt' : null;
          if (!licensePath) throw new Error(`Missing license for ${pkg}`);
          notices += `${metadata.name} ${metadata.version}\n${await fs.readFile(licensePath, 'utf8')}\n\n`;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      this.emitFile({type: 'asset', fileName: 'third-party-notices.txt', source: notices});
    },
  }],
});
