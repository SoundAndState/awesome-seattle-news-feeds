import {defineConfig} from 'vite';
import fs from 'node:fs/promises';
import {loadCatalog, validateCatalog} from '../scripts/catalog.mjs';
import {renderOpml} from '../scripts/render.mjs';
import config from './site.config.json' with {type: 'json'};

export default defineConfig({
  root: 'web',
  base: config.base,
  // Never load the repository's private .env into the frontend build.
  envDir: false,
  define: {__PROXY_URL__: JSON.stringify(config.proxy)},
  build: {outDir: '../dist', emptyOutDir: true},
  plugins: [{
    name: 'curated-catalog',
    async transformIndexHtml(html) {
      const catalog = await loadCatalog();
      const origins = [...new Set([config.proxy, ...catalog.feeds.flatMap(feed => [feed.feed, ...(feed.redirects || [])])].map(url => new URL(url).origin))].sort();
      const image = new URL('social-card.png', config.url).href;
      const imageAlt = 'Sound & State — a Greater Seattle news reader. Articles, local posts, and a shared saved library.';
      const metadata = [
        ['name', 'application-name', config.name],
        ['name', 'description', config.description],
        ['property', 'og:type', 'website'],
        ['property', 'og:site_name', config.name],
        ['property', 'og:title', config.title],
        ['property', 'og:description', config.description],
        ['property', 'og:url', config.url],
        ['property', 'og:locale', 'en_US'],
        ['property', 'og:image', image],
        ['property', 'og:image:type', 'image/png'],
        ['property', 'og:image:width', '1200'],
        ['property', 'og:image:height', '630'],
        ['property', 'og:image:alt', imageAlt],
        ['name', 'twitter:card', 'summary_large_image'],
        ['name', 'twitter:title', config.title],
        ['name', 'twitter:description', config.description],
        ['name', 'twitter:image', image],
        ['name', 'twitter:image:alt', imageAlt],
      ];
      return {html: html.replace('__FEED_CONNECT_ORIGINS__', origins.join(' ')), tags: [
        {tag: 'title', children: config.title.replaceAll('&', '&amp;'), injectTo: 'head'},
        {tag: 'link', attrs: {rel: 'canonical', href: config.url}, injectTo: 'head'},
        ...metadata.map(([attribute, key, content]) => ({tag: 'meta', attrs: {[attribute]: key, content}, injectTo: 'head'})),
      ]};
    },
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
      notices += `Noto Serif (Google Fonts)\n${await fs.readFile('web/src/fonts/noto-serif/OFL.txt', 'utf8')}\n`;
      notices += `SpinKit Flow (https://github.com/tobiasahlin/SpinKit)\n${await fs.readFile('third-party/spinkit-license.txt', 'utf8')}\n`;
      this.emitFile({type: 'asset', fileName: 'third-party-notices.txt', source: notices});
    },
  }],
});
