# Maintaining the reader

[Sound & State](https://sayhiben.github.io/awesome-seattle-news-feeds/) is the public reader for this collection. `feeds.json` remains the only source for subscriptions: the README, OPML, reader catalog, and proxy destinations all derive from it.

## Architecture

- GitHub Pages serves the static Vite application, a reduced `catalog.json`, and `feeds.opml`. The browser verifies the two catalogs agree before using them.
- Feedsmith parses RSS/Atom in the browser. Dexie stores articles, feed health, and read/saved state in IndexedDB. DOMPurify sanitizes previews using a small text-oriented tag allowlist; remote media, scripts, styles, and embedded frames are removed. Article links open the publisher directly.
- The Cloudflare Worker accepts only `/feed/<catalog-id>` with no query parameters. It retrieves the exact HTTPS feed destination, returns the feed, and adds CORS headers for configured reader origins. It has no credentials, user database, scheduled collection, or article extraction.
- Cloudflare Workers Cache is enabled. Public feed responses are cached for up to 15 minutes, shortened by upstream freshness directives and Age. Responses with private/no-store/no-cache, cookies, or `Vary: *` are not cached. Errors are never cached. `Vary: Origin` separates CORS responses. Each deployment gets a new cache version.
- Redirects fail closed unless the exact destination is listed in that feed's optional `redirects` array in `feeds.json`. Check the whole redirect chain before adding destinations. Historical `aliases` are never automatically approved for proxy requests.
- Requests have a 15-second upstream deadline, a 5 MiB response limit, at most three redirects, and a generous 240 requests/minute per-IP limit on cache misses. CORS is not authentication. Cache hits bypass Worker code and its limiter; all requests still count toward Cloudflare's account limits.

The reader refreshes on opening or on an explicit Refresh, without background polling. Fresh feeds wait 15 minutes; failed feeds back off from 30 minutes to six hours. It uses four simultaneous requests, a cross-tab refresh lock where supported, and preserves articles on refresh errors. Unsaved articles expire 30 days after first retrieval, with a cap of 150 per feed. Saved stories persist. Backups contain reading state and saved articles; restoring merges them. Browser data can still be evicted or cleared, and the app shell requires a connection when opening the site.

## Local development

Use Node.js 24 or newer.

```sh
npm ci
npm run ci
npm run preview
```

Open `http://127.0.0.1:4173/awesome-seattle-news-feeds/`. The production proxy permits the listed local preview origins. Rebuild with `npm run build:web` after changes. Only explicit public settings in `site.config.json` enter the frontend; Vite does not read the repository `.env`.

Browser tests use fixture feeds, including hostile HTML, and cover filtering, read/saved persistence, backup restore, failed refreshes, and mobile layout:

```sh
npx playwright install chromium
npm run test:browser
```

`npm test` also exercises proxy destination/CORS rules, redirects, rate limiting, size limits, feed formats, freshness, and catalog consistency. Weekly feed-health checks remain separate from deterministic validation because publisher availability varies by network.

## Publishing

Repository Actions secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` authenticate proxy deployment. Use a token limited to this account with Workers Scripts Edit and required account read permissions. GitHub Pages must use GitHub Actions as its build source.

After validation succeeds on main, the publishing workflow deploys the proxy and then the Pages artifact. It refuses a superseded commit. Only `dist/` is uploaded to Pages. Pull requests run validation and fixture tests without Cloudflare credentials. A manual publishing run should use the validated main commit.

For local proxy deployment, put the two variables from `.env.example` in an ignored `.env` or the process environment, then run `npm run deploy:proxy`. `.env`, `.dev.vars`, Wrangler state, test reports, and build output are excluded from Git. Never put tokens in `site.config.json`, browser code, or Wrangler public variables. Rotate credentials through Cloudflare and replace the matching GitHub secret when needed.

This deployment creates one Worker with its provided `workers.dev` address and no paid data services. Watch actual account usage in Cloudflare; free-plan capacity is shared across the account, and cache hits still consume requests. A full fresh visit can request all 96 feeds. See [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Workers Cache](https://developers.cloudflare.com/workers/cache/) for current terms.

Publisher refusals (including Seattle Times bot responses) appear in the source directory. Do not replace those errors with empty success responses or discard previously loaded stories. A working URL from one network is not a guarantee it works from Cloudflare.

Initial live checks on September 15, 2026 read 84–85 of the 96 feeds through the deployed relay and showed over 1,400 stories in Chromium. Seattle Times sections and several other publishers refused relay requests. KING 5 redirected the relay to a YouTube channel, which was correctly rejected as an unapproved destination. These feeds remain in the catalog for readers that can access them directly.
