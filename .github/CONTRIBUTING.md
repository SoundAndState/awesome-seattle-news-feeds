# Contributing

Submit feed additions and corrections as pull requests editing only [`data/feeds.json`](../data/feeds.json). GitHub Actions compiles and validates the README and OPML, with generated files available as a workflow artifact for review. After merge, Actions commits the generated files and publishes the reader and proxy.

## Merging pull requests

Submit changes through pull requests to `main`. Use **Merge when ready** on GitHub or `gh pr merge --auto` to enter the merge queue once the required `validate` check passes. Let the queue merge the pull request; do not bypass it or push directly to `main`.

The queue tests each change with the latest `main` and any changes ahead of it. It runs one queue build at a time, requires every queued change to pass, and waits up to 60 minutes for checks. It uses squash merges and can merge up to five passing pull requests together. The queue does not require you to update your branch just because another pull request merged first.

Validation also runs on pull requests and pushes to `main`. A newer run cancels older validation for the same event and branch or pull request. Each merge group runs separately and does not cancel another group's checks. Publication follows successful validation of a push to `main`, or a manual publishing run.

[The ruleset](merge-queue.ruleset.json) records the GitHub settings. The publishing workflow uses the repository's `Generated catalog publication` deploy key, stored in the `CATALOG_PUSH_KEY` Actions secret, to commit generated README and OPML files. The ruleset allows deploy keys to bypass the queue; keep write access limited to this publishing key. Changes to the ruleset file do not update GitHub automatically; a repository administrator must apply them in the repository's rules settings or through the GitHub API.

The generated-file commit uses `[skip ci]` because publication has already compiled and checked those files. Keep that marker out of pull request commits so their required checks can run.

Keep this repository public in the SoundAndState organization on GitHub Free. [Merge queues support public organization repositories](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue). Use standard GitHub-hosted runners and keep the organization's paid-usage budgets at $0 with usage blocking enabled.

## Catalog changes

- Follow [`data/feeds.schema.json`](../data/feeds.schema.json). Use a unique, stable `id`, an existing category, the publisher's HTTPS website and RSS or Atom URL, a concise description, and a `checkedOn` date in `YYYY-MM-DD` format.
- Check that the feed has current, relevant stories. Prefer original reporting and direct publisher feeds. Label opinion, advocacy, official announcements, and satire accurately.
- Base descriptions on the publisher's own account of its work and communities. Use the [publisher-description review process](../docs/publisher-description-review.md) to record evidence, apply consistent labels, and avoid unsupported identity assumptions.
- Check existing entries and `aliases` for duplicates. Keep distinct topic feeds. Add `redirects` only for verified, exact HTTPS destinations needed by the proxy.
- Put Bluesky accounts in the `bluesky` category. Use the native `https://bsky.app/profile/<did>/rss` feed and the current profile URL; account IDs keep subscriptions stable across handle changes.
- The maintainer decides which sources to include and may decline sources that do not meet these standards.

## Development

Use Node.js 24 or newer. `npm ci && npm run ci` builds and validates the catalog, lints the README and OPML, runs unit tests, and builds the reader. `npm run preview` serves the reader locally.

For reader changes, run `npm run test:browser:install`, `npm run build:web`, and `npm run test:browser`. Tests cover desktop Chromium, Firefox, and WebKit, plus Android-sized Chromium and iPhone-sized WebKit. The install and test commands use the same project-local browser cache under `.work/playwright-browsers`; they also honor an explicit `PLAYWRIGHT_BROWSERS_PATH`. On Linux, add `-- --with-deps` to the install command when system dependencies are missing.

For a focused run, use `npm run test:browser -- --project=firefox` or pass a test filename. Local runs use up to four workers; add `-- --workers=2` to the test command to reduce concurrency. To record a failure trace locally, run `npm run test:browser -- --project=firefox --trace=retain-on-failure`. CI runs the five browser projects in parallel jobs with two workers each, records traces on one diagnostic retry, and fails if a test needs that retry to pass. Failed jobs upload reports, screenshots, and available traces.

If Firefox fails to launch on Windows with `spawn UNKNOWN` or a side-by-side configuration error, use the project-local install and test commands above. Reinstalling the shared browser cache did not resolve this failure on the affected machine; the same browser build worked from a fresh directory. If you explicitly set `PLAYWRIGHT_BROWSERS_PATH`, install into a fresh directory and use that same setting when running tests. Do not modify the Firefox binaries or skip Firefox coverage.

For live feed checks, use Python 3.12 or newer and `npm run check:feeds`.

Use the [shared test fixtures](../tests/fixtures/README.md) for application tests. The browser harness supplies a fictional catalog, feed responses, and a fixed reference time; it blocks unexpected external requests. Keep production data in the few checks that verify the published catalog and build artifacts. Extend the shared builders for common scenarios, and keep specialized malformed inputs beside the tests that explain them.

Catalog sources live in `data/`; build, browser-test, site, and feed-service configuration lives in `config/`. Run the npm commands from the repository root so they load the correct configuration. For feed-service changes, run `npm test` and `npm run check:proxy` to check the Worker bundle before deployment.

Follow the [writing guidelines](../AGENTS.md#writing-for-readers) when changing reader text. [AGENTS.md](../AGENTS.md) contains shared agent instructions; [CLAUDE.md](../CLAUDE.md) imports them. The [agent guidance design note](../docs/agent-guidance.md) explains the repository skills, supporting research, and how to maintain them.

For guidance validation or Python tests, install the checker dependency with `python -m pip install -r scripts/requirements-agent-guidance.txt`. Run `npm run check:agents` for instruction changes; the [validation guide](../docs/agent-guidance-validation.md) defines additional checks by change type.

Deployment uses the repository's `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` Actions secrets. Local deployment reads the same variables from the environment or ignored `.env`; run `npm run deploy:proxy`. Never commit credentials.

Keep optional feed-service logging disabled. Follow the [Cloudflare privacy guide](../docs/cloudflare-privacy.md) to check deployment, account, and domain settings and understand which records the hosting providers may still retain.

Contributions use [CC0 1.0](../license). Publisher content retains its original copyright.
