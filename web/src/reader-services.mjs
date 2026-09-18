import {createBrowserLibrary} from './storage.mjs';
import {createBrowserRuntime} from './browser-runtime.mjs';
import {loadCatalog, loadFeed} from './network.mjs';
import {cleanText} from './content.mjs';
import {readerNavigation} from './navigation.mjs';

// Compose browser infrastructure once, using the same validated configuration
// as the UI. The store receives services; it never imports this factory.
export function createBrowserReaderServices(site) {
  const pageUrl = location.href;
  return {
    library: createBrowserLibrary(site),
    runtime: createBrowserRuntime(),
    loadCatalog: options => loadCatalog(site, {pageUrl, ...options}),
    loadFeed: (feed, options) => loadFeed(feed, site.proxy, options),
    createNavigation: readerNavigation,
    cleanText,
  };
}
