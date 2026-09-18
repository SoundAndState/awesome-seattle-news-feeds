import {defineConfig} from 'vite';
import fs from 'node:fs/promises';
import {renderOpml} from '../scripts/render.mjs';
import {loadReaderConfig} from './reader-config.mjs';

const {site: config, catalog, opmlCatalog, origins, publicDir} = await loadReaderConfig();

export default defineConfig({
  root: 'web',
  publicDir,
  base: config.base,
  // Never load the repository's private .env into the frontend build.
  envDir: false,
  define: {__READER_CONFIG__: JSON.stringify(config)},
  oxc: {jsx: {runtime: 'automatic'}},
  build: {
    outDir: '../dist', emptyOutDir: true,
    // Keep framework code cacheable across catalog, branding, and reader edits.
    rolldownOptions: {output: {codeSplitting: {groups: [
      {name: 'react-runtime', test: /node_modules[\\/](?:react|react-dom|scheduler|zustand)[\\/]/, priority: 20},
    ]}}},
  },
  plugins: [{
    name: 'curated-catalog',
    async transformIndexHtml(html) {
      const image = new URL(config.assets.socialImage, config.url).href;
      const imageAlt = `${config.name} — ${config.description}`;
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
      const shell = html.replace('__FEED_CONNECT_ORIGINS__', origins.join(' ')).replace('href="./favicon.svg"', `href="${config.assets.logo}"`);
      return {html: config.opmlUrl ? shell : shell.replace(/<noscript>[\s\S]*?<\/noscript>/, '<noscript><p>This reader needs JavaScript to show its collection.</p></noscript>'), tags: [
        {tag: 'title', children: config.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'), injectTo: 'head'},
        {tag: 'link', attrs: {rel: 'canonical', href: config.url}, injectTo: 'head'},
        ...metadata.map(([attribute, key, content]) => ({tag: 'meta', attrs: {[attribute]: key, content}, injectTo: 'head'})),
      ]};
    },
    async buildStart() {
      this.emitFile({type: 'asset', fileName: 'catalog.json', source: JSON.stringify(catalog)});
      this.emitFile({type: 'asset', fileName: 'feeds.opml', source: renderOpml(opmlCatalog)});
      let notices = 'Third-party software included in this reader\n\n';
      for (const pkg of ['react', 'react-dom', 'scheduler', 'zustand', 'feedsmith', 'dexie', 'dompurify', 'entities', 'feedsmith/node_modules/fast-xml-parser', 'strnum', 'fast-xml-builder', 'xml-naming', 'path-expression-matcher', 'is-unsafe', '@nodable/entities']) {
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
      notices += `Radix Colors (https://github.com/radix-ui/colors)\n${await fs.readFile('third-party/radix-colors-license.txt', 'utf8')}\n`;
      notices += `Noto Serif (Google Fonts)\n${await fs.readFile('web/src/fonts/noto-serif/OFL.txt', 'utf8')}\n`;
      notices += `SpinKit Flow (https://github.com/tobiasahlin/SpinKit)\n${await fs.readFile('third-party/spinkit-license.txt', 'utf8')}\n`;
      for (const [name, directory] of [['Source Serif 4', 'source-serif-4'], ['Source Sans 3', 'source-sans-3']]) {
        notices += `${name} (Adobe / Google Fonts)\n${await fs.readFile(`web/src/fonts/${directory}/OFL.txt`, 'utf8')}\n`;
      }
      this.emitFile({type: 'asset', fileName: 'third-party-notices.txt', source: notices});
    },
  }],
});
