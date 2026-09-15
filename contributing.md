# Contributing

Thanks for helping people follow Seattle and Washington news.

## Editorial criteria

- Prefer original local reporting, a clear publisher identity, and a working public RSS or Atom feed with recent, relevant items.
- Read sample stories. A successful HTTP response or valid XML alone does not establish editorial quality.
- Label commentary, advocacy, official communications, community announcements, and satire. Describe mixed national coverage where present.
- Prefer a publisher's direct HTTPS feed and a local section over a sitewide feed. Distinct topic feeds may coexist; aliases and duplicate subscriptions may not.
- Do not add parked domains, unrelated commercial replacements, empty feeds, or long-inactive feeds to the current bundle. Record an import exclusion or open an issue with evidence.
- A blocked request is inconclusive. Recheck before declaring a source defunct. We welcome repaired feeds for excluded publishers and more coverage outside Puget Sound.

## Making a change

Use Node.js 24 or later and Python 3.12 or later for the optional live checks.

```sh
npm ci
# Edit feeds.json; feeds.schema.json documents the fields.
npm run build
npm run ci
npm run check:feeds
```

Commit `feeds.json` and the generated `readme.md`, `feeds.opml`, and `docs/import-review.md` together. Do not edit generated files by hand. Add an alias when replacing a known feed address; keep the historical import decision accurate. The original `reference/feedly-export.opml` is provenance, not the maintained catalog.

The pull request workflow checks the JSON schema, duplicate URLs and aliases, complete import accounting, reproducible output, Awesome formatting, and OPML syntax and structure. `awesome-lint` uses GitHub metadata, so run it in a checkout with an origin and upstream branch. The only disabled Awesome rule is the 30-day repository age rule, which concerns submission to the central Awesome list. Remove that documented exception before submitting this repository there.

The separate feed-health workflow runs weekly and on demand. It tests current responses, parses RSS/Atom, checks dates, and reports redirects and duplicate article sets. It fails for broken, empty, undated, or more-than-one-year-stale feeds. Network checks are separate from pull request validation because publishers can block automated requests or have transient outages. Inspect the uploaded report and verify failures before changing the catalog.

Include the date checked, feed URL, and a short explanation of relevance in your pull request. For editorial disagreements, discuss specific evidence and distinguish an outlet's reported facts from its opinion pieces.

## Licensing

Contributions to this directory are made under [CC0 1.0](license). Linked articles and publisher content retain their own copyrights.
