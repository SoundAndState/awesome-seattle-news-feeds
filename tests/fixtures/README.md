# Shared test data

Use these fictional sources and feed builders for application tests. Keep the
default catalog small; generate a larger one only when the behavior requires it.
Do not copy publisher feeds into new fixture files or select test sources from
the production catalog.

- [`catalog.mjs`](catalog.mjs) exports `makeSource(overrides)` and
  `makeCatalog({regionalCount, feeds})`. Each call returns independent objects,
  including aliases and categories. The default catalog has 13 news sources and
  two Bluesky accounts. It covers each reader classification and has enough
  stories for scrolling. Use `regionalCount: 62` to exercise pagination beyond
  the reader's 60-item page.
- [`feeds.mjs`](feeds.mjs) exports `rssFeed(items)` and `atomFeed(entries)`, plus
  `articleItem(id, overrides)`, `postItem(id, overrides)`, `postUrl(id)`, and
  `postId(id)`. Item overrides control titles, links, content, and dates. Pass
  `null` to omit an optional field and an empty list to create an empty feed.
  Keep raw namespace, malformed XML, unusual escaping, and other adversarial
  inputs beside the assertions that explain them; use `extraXml` or `channelXml`
  when only part of an otherwise valid feed needs special syntax.
- [`rss.xml`](rss.xml) and [`atom.xml`](atom.xml) are the common minimal feed
  samples. JavaScript builders use their envelopes, and the Python health tests
  read these same files. `NOW`, `PUBLISHED`, and `UPDATED` in `feeds.mjs` define
  the shared dates. Python uses the same reference time as `NOW`.
- [`json-feeds.mjs`](json-feeds.mjs) exports `jsonFeed(items)` and
  `postsJson(posts)` for the portable JSON adapters. Use these builders
  for alternate-brand browser checks as well as normalization tests.
- [`reader-runtime.mjs`](reader-runtime.mjs) exports `makeReaderRuntime` for
  store tests. It supplies an independent clock, online/visibility state,
  optional locks, and event subscriptions without replacing browser globals.
  Use `advance`, `setOnline`, and `setVisible` to drive lifecycle transitions.

For example, a unit test can supply an update-only article without another XML
file:

```js
import {makeSource} from './fixtures/catalog.mjs';
import {articleItem, rssFeed, NOW} from './fixtures/feeds.mjs';
import {normalizeFeed} from '../web/src/feeds.mjs';

const source = makeSource();
const xml = rssFeed([articleItem(source.id, {published: null})]);
const items = normalizeFeed(xml, source, Date.parse(NOW));
```

## Browser setup

Import `test` and `expect` from [`../browser/fixtures.mjs`](../browser/fixtures.mjs).
That fixture supplies a catalog and matching OPML, synthetic publisher responses,
isolated browser storage, and a clock starting at `NOW`. It aborts direct feed
requests by default. It blocks and reports other unexpected external requests
instead of allowing a test to contact a live service.

Use `loadReader(page)` for the default article list. Use `test.use` with
`readerCatalog` and `feedBodies` for a suite's common scenario. Use
`browserCatalog({feeds})` for a subset and `browserCatalog({regionalCount: 62})`
for pagination; use a fresh factory result when modifying data. `loadReader`
also accepts `{catalog, bodies, fail}` overrides. A test can override routes to
control failures, response timing, direct fallback, or an explicitly opened
external link. Use `newReaderPage(options)` when a test needs another browser
context with the same setup and network guard.

`browserCatalog` puts fictional direct feed URLs on the configured service origin
so the production Content Security Policy permits requests to reach the mocks.
It does not change the application's policy or contact the service. Keep these
browser-specific URLs out of the shared catalog factory; parser and catalog tests
need representative publisher and Bluesky URL formats.

## Deliberate production-data checks

Only use real data when it is the thing under test, and explain that reason:

- The catalog integration test validates `data/feeds.json` and its generated OPML.
- [`../browser/published.spec.mjs`](../browser/published.spec.mjs) checks shipped
  metadata, the sharing image, and native OPML downloads. Download interception
  differs between browser engines, so these tests use the actual local build.
  They still mock every publisher response.
- Snapshot tests use one production allowlist ID to exercise the policy. The
  URL, body, timestamps, and storage responses remain fictional.

Live publisher checks belong in the explicit `npm run check:feeds` command, not
the unit or browser suites. Schema and site configuration imports remain real
because they define the application's validation and deployment contracts.
