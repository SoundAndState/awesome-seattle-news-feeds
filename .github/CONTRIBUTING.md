# Contributing

Submit feed additions and corrections as pull requests editing only [`data/feeds.json`](../data/feeds.json). GitHub Actions compiles and validates the README and OPML, with generated files available as a workflow artifact for review. After merge, Actions commits the generated files and publishes the reader and proxy.

## Catalog changes

- Follow [`data/feeds.schema.json`](../data/feeds.schema.json). Use a unique, stable `id`, an existing category, the publisher's HTTPS website and RSS or Atom URL, a concise description, and a `checkedOn` date in `YYYY-MM-DD` format.
- Check that the feed has current, relevant stories. Prefer original reporting and direct publisher feeds. Label opinion, advocacy, official announcements, and satire accurately.
- Base descriptions on the publisher's own account of its work and communities. Use the [publisher-description review process](../docs/publisher-description-review.md) to record evidence, apply consistent labels, and avoid unsupported identity assumptions.
- Check existing entries and `aliases` for duplicates. Keep distinct topic feeds. Add `redirects` only for verified, exact HTTPS destinations needed by the proxy.
- Put Bluesky accounts in the `bluesky` category. Use the native `https://bsky.app/profile/<did>/rss` feed and the current profile URL; account IDs keep subscriptions stable across handle changes.
- The maintainer decides which sources to include and may decline sources that do not meet these standards.

## Development

Use Node.js 24 or newer. `npm ci && npm run ci` builds and validates the catalog, lints the README and OPML, runs unit tests, and builds the reader. `npm run preview` serves the reader locally.

For reader changes, run `npx playwright install chromium webkit` and `npm run test:browser`. Tests cover desktop Chromium and mobile WebKit. For live feed checks, use Python 3.12 or newer and `npm run check:feeds`.

Catalog sources live in `data/`; build, browser-test, site, and feed-service configuration lives in `config/`. Run the npm commands from the repository root so they load the correct configuration. For feed-service changes, run `npm test` and `npm run check:proxy` to check the Worker bundle before deployment.

Follow the [writing guidelines](../AGENTS.md#writing-for-readers) when changing reader text. [AGENTS.md](../AGENTS.md) contains shared agent instructions; [CLAUDE.md](../CLAUDE.md) imports them. The [agent guidance design note](../docs/agent-guidance.md) explains the repository skills, supporting research, and how to maintain them.

For guidance validation or Python tests, install the checker dependency with `python -m pip install -r scripts/requirements-agent-guidance.txt`. Run `npm run check:agents` for instruction changes; the [validation guide](../docs/agent-guidance-validation.md) defines additional checks by change type.

Deployment uses the repository's `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` Actions secrets. Local deployment reads the same variables from the environment or ignored `.env`; run `npm run deploy:proxy`. Never commit credentials.

Contributions use [CC0 1.0](../license). Publisher content retains its original copyright.
