# Contributing

Submit feed additions and corrections as pull requests editing only [`feeds.json`](feeds.json). GitHub Actions compiles and validates the README and OPML, with generated files available as a workflow artifact for review. After merge, Actions commits the generated files and publishes the reader and proxy.

## Catalog changes

- Follow [`feeds.schema.json`](feeds.schema.json). Use a unique, stable `id`, an existing category, the publisher's HTTPS website and RSS or Atom URL, a concise description, and a `checkedOn` date in `YYYY-MM-DD` format.
- Check that the feed has current, relevant stories. Prefer original reporting and direct publisher feeds. Label opinion, advocacy, official announcements, and satire accurately.
- Check existing entries and `aliases` for duplicates. Keep distinct topic feeds. Add `redirects` only for verified, exact HTTPS destinations needed by the proxy.
- Low-quality sources may not be accepted. Inclusion is subject to the maintainer's discretion.

## Development

Use Node.js 24 or newer. `npm ci && npm run ci` builds and validates the catalog, lints the README and OPML, runs unit tests, and builds the reader. `npm run preview` serves the reader locally.

For reader changes, run `npx playwright install chromium` and `npm run test:browser`. For live feed checks, use Python 3.12 or newer and `npm run check:feeds`.

Deployment uses the repository's `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` Actions secrets. Local deployment reads the same variables from the environment or ignored `.env`; run `npm run deploy:proxy`. Never commit credentials.

Contributions use [CC0 1.0](license). Publisher content retains its original copyright.
