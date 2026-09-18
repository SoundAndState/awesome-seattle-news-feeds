# Reader items and source adapters

The reader has one stored item shape, defined by `ReaderItem`, `ITEM_LIMITS`, and
the construction/validation functions in
[`item-model.mjs`](../web/src/item-model.mjs). Parser-specific objects stop at
the adapter boundary. React components and reader state never inspect RSS,
Atom, JSON Feed, or posts-JSON field names.

## Responsibilities

| Module | Responsibility |
| --- | --- |
| [source-model.mjs](../web/src/source-model.mjs) | Supported format names, explicit Articles/Posts kinds, and legacy source classification. |
| [source-adapters/index.mjs](../web/src/source-adapters/index.mjs) | Select the adapter; preserve automatic XML/JSON Feed detection. |
| [source-adapters/xml.mjs](../web/src/source-adapters/xml.mjs) | Interpret RSS/Atom links, extensions, bylines, dates, and legacy Bluesky text/native IDs. |
| [source-adapters/json.mjs](../web/src/source-adapters/json.mjs) | Validate JSON Feed 1/1.1 or curated posts version 1 and translate only that format's fields. |
| [feeds.mjs](../web/src/feeds.mjs) | Keep the public `normalizeFeed(text, source, now)` API; construct bounded source items and collapse repeated identities within a response. |
| [item-model.mjs](../web/src/item-model.mjs) | Item identity, bounds, structural validation, plain-text preparation, and cross-source merge policy. |
| [links.mjs](../web/src/links.mjs) | Safe destination URLs and optional archive-search links, independently of parsing. |
| [refresh-policy.mjs](../web/src/refresh-policy.mjs) | Retry timing and bounded concurrency, independently of parsing. |
| [opml.mjs](../web/src/opml.mjs) | Verify agreement between the public catalog and OPML. |

`feeds.mjs` retains its earlier exports for compatibility with parser consumers,
including the snapshot collector. Production code imports links, scheduling,
and backup primitives from their owning modules. No new package is required.

## Adapter entry boundary

Each registered adapter is a synchronous function `(text, source, now)` returning
an array of entries. It rejects an invalid envelope before anything reaches the
store. An entry supplies:

- `url`: the original link, possibly relative or absent. The common model
  resolves it against the source website and rejects unsafe destinations.
- `title`, `html`, `author`: strings. Titles may contain publisher markup or
  escaped literal text at this boundary; they are not ready for direct display.
- `guid`: the publisher's stable identifier when present. `identityDate` is the
  original date value used only for the legacy linkless identity fallback.
- `nativeId`: an optional platform-native identity. Currently this preserves
  existing Bluesky `at://` identities, even when an account changes its handle.
- `published`, `updated`, `publishedDateOnly`, `updatedDateOnly`: interpreted
  timestamps and flags. Missing/invalid dates become zero, independently for
  publication and update. Feed-level timestamps do not become story dates.

The XML adapter owns extension and account-specific interpretation. JSON Feed
ignores unrelated RSS-style fields such as `pubDate`, `content.encoded`, and
`dc.creators`; they cannot override its declared content, dates, or authors.
Explicit `posts-json` is required for the custom envelope. Existing `rss` and
`atom` labels retain permissive detection if a publisher switches formats.

Adapters examine at most 300 entries. `normalizeFeed` uses `createSourceItem` for
every entry, then keeps the last occurrence of a repeated identity, preserving
the earlier reader's policy. A malformed accepted entry rejects the response;
the store does not receive a partly validated result. Empty JSON collections
remain valid; empty XML feeds retain the existing unavailable-feed behavior.

## Stored item contract

`mergeSourceItem` calls `prepareItem` before new content enters the library.
That function receives the production plain-text sanitizer as a dependency.
Backups use the same preparation and validation functions while preserving the
imported ID. The stored shape contains:

| Fields | Meaning |
| --- | --- |
| `id`, `url`, `kind` | Stable identity, safe HTTP(S) destination or empty string, and Articles/Posts classification. |
| `title`, `author`, `sourceName`, `excerpt` | Plain text for display/search, including fallback attribution after source removal. |
| `html` | Bounded but **untrusted** publisher content. It is sanitized by `articleContent` before entering the DOM. |
| `feedIds` | Ordered source provenance, with the primary source first. |
| `published`, `updated` and their date-only flags | Independent publisher dates; zero represents an absent date. |
| `firstSeen` | Local arrival time retained when an existing item is refreshed. |

Limits remain 4,096 characters for IDs, 2,000 for titles, 100,000 for HTML, 500
for author names, 200 for fallback source names, 260 for excerpts, 120 per source
ID, and 1,000 source IDs per item. New source items are bounded on construction;
backup validation rejects oversized HTML or provenance before applying anything.
Legacy title/byline text is bounded during preparation. A merge exceeding the
provenance limit fails before replacing the visible library instead of creating
an item that cannot later be restored from backup.

Text escaping in adapters is not HTML sanitization. Literal JSON text and
Bluesky descriptions are escaped before becoming HTML; publisher HTML stays
untrusted in feeds, storage, and backups. The existing DOMPurify display boundary
removes scripts, trackers, and unsafe links for every format.

## Identity and merging

The identity order is an adapter-supplied native ID, a canonical story URL, then
`source-id:guid`. Canonical URLs remove fragments and the existing tracking
parameters and sort query parameters. If a linkless XML item supplies no GUID,
the fallback remains `source-id:original-title:original-date`. Compute it before
title truncation or plain-text conversion. This legacy fallback is not stable
across title/date edits; changing it requires a deliberate migration.

For a canonical duplicate across Articles and Posts, article content and its
primary publisher win in either arrival order. Keep the union of source IDs and
the original local arrival time. Within one kind, preserve the existing policy:
the latest received content wins while existing primary attribution is retained.
The merge function returns a new object and does not mutate either input.

Read/saved marks remain separate records keyed by unchanged item identity.
Restoring a backup retains current library content when an ID already exists;
an older backup cannot replace it after reload. Older records may omit `kind`,
author, update date, and date-only flags. Shared preparation supplies optional
defaults without rewriting IDs, and legacy post classification still works
after a source leaves the catalog. Database schemas and backup version 1 remain.

## Adding an adapter

1. Implement the entry contract in `source-adapters/`; register the function and
   add its format name to `SOURCE_FORMATS`. Define its envelope explicitly.
2. Extend the shared [contract fixture](../tests/fixtures/source-contracts.mjs)
   and [contract tests](../tests/item-contract.test.mjs). Every registered format
   must cover identity, dates, limits, malformed input, merge behavior, and backup
   round-trips. Add format-specific adversarial cases alongside their assertions.
3. Exercise the production sanitization and saved-item reload path in
   [browser tests](../tests/browser/item-contracts.spec.mjs).
4. Update the [configuration guide](reader-configuration.md) and assess delivery
   separately. Reader support does not change publisher CORS or extend the
   Cloudflare service's XML rules and exact destination allowlist.

No component or state-orchestration change is needed for a format satisfying
this contract. New item kinds, changed identity rules, or wider stored limits
require a separate compatibility decision. Collection ownership, atomic imports,
and schema evolution are defined in [reader persistence](reader-persistence.md).
