# Contributing

Suggest a source or correction by [opening an issue](https://github.com/sayhiben/awesome-seattle-news-feeds/issues/new) or submitting a pull request. Include the publisher, website, feed URL, date checked, and a brief explanation of its Seattle or Washington coverage.

## What belongs here

- Recognizable regional publishers with populated, current RSS or Atom feeds. Read recent items to confirm their relevance.
- Clearly labeled reporting, commentary, advocacy, official updates, community announcements, and satire. Note national coverage or an author's organizational role where relevant.
- Direct publisher feeds where available. Keep distinct topic feeds; consolidate aliases and duplicate subscriptions.

An access block does not mean a publication has closed. Recheck uncertain feeds and consult the [import review](docs/import-review.md) and [follow-up review](docs/follow-up-review-2026-09-15.md) before restoring an excluded source. Preserve a record of unresolved or historical sources without adding them to the active download.

## Submitting an edit

Edit `feeds.json`, then regenerate and check the published files with Node.js 24 or later:

```sh
npm ci
npm run build
npm run ci
```

Commit the JSON and generated files together. Check changed feeds in a reader; `npm run check:feeds` also checks live feeds with Python 3.12 or later. Publisher access restrictions can affect automated checks.

Contributions use [CC0 1.0](license). Linked articles retain their publishers' copyrights.

Reader development and deployment are documented in [Maintaining the reader](docs/reader-maintenance.md).
