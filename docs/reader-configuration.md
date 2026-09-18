# Configure another reader

The reader accepts a curated catalog and a site configuration at build time. One
build represents one locale or topic. Anonymous readers keep their reading
history, saved items, and preferences in their own browser; there is no account
or shared reading-history service.

Sound & State continues to use [`config/site.config.json`](../config/site.config.json)
and the editorial [`data/feeds.json`](../data/feeds.json). Its existing browser
library remains in the `sound-and-state` database. Other builds must provide a
different `storageNamespace`; the database and refresh lock use that namespace.
Use a separate origin for unrelated operators: namespaces prevent accidental
mixing, but browser storage is not a security boundary between apps on one origin.

## Site configuration

Create a JSON file such as `my-reader/site.json`:

```json
{
  "name": "Neighborhood Reader",
  "homeLabel": "Neighborhood Reader home",
  "title": "Neighborhood Reader — Local reporting and updates",
  "description": "A curated collection of neighborhood reporting and community updates.",
  "tagline": "news and updates from our neighborhood",
  "url": "https://reader.example/",
  "base": "/",
  "catalog": "./catalog.json",
  "publicDir": "./public",
  "proxy": "",
  "repository": "https://github.com/example/neighborhood-reader",
  "storageNamespace": "neighborhood-reader",
  "theme": "blue",
  "assets": {"logo": "./favicon.svg", "socialImage": "./social-card.png"},
  "capabilities": {"articles": true, "posts": true, "archive": false, "backups": true},
  "about": {
    "purpose": "Follow local reporting and discover updates from community accounts.",
    "hosting": "Describe the services hosting this reader and its feed service."
  }
}
```

Paths for `catalog` and `publicDir` resolve relative to this file. Put the logo
and sharing image in `publicDir`; use an SVG favicon and a 1200 × 630 PNG sharing
image. Asset paths must stay on the reader's website. A site hosted in a subpath
uses, for example, `base: "/neighborhood/"` and the matching full `url`.

`theme` selects `jade` or `blue`; visitors can independently choose automatic,
light, or dark appearance. Both palettes use the existing free, MIT-licensed
Radix Colors theme foundation. `categoryLabels` optionally maps category IDs to
shorter navigation labels without changing their catalog titles.

`about` contains optional plain-text disclosures. `purpose` explains the
collection's editorial purpose and `hosting` names the services that receive page
and feed requests. `serviceDetails` describes actual service privacy settings,
`delivery` explains a custom retry or fallback policy, `cache` describes shared
feed caching, and `snapshots` describes any scheduled backup-feed collection.
These fields do not enable server features. Leave unimplemented features absent;
the reader supplies a generic explanation based on whether `proxy` is set. A new
brand does not inherit Sound & State's hosting or snapshot claims.

Set `opmlUrl` to `null` to disable the feed-list download and matching-list check.
Otherwise its fixed public path is `feeds.opml`; `catalog.json` remains the fixed
catalog path. The `articles` and `posts` capability flags select the available
reading modes, `archive` enables the optional Ghostarchive lookup, and `backups`
enables JSON library export and restore. Capabilities do not change the privacy
of existing browser data.

Set `proxy` to an HTTPS feed service that accepts `/feed/{catalog-id}` and is
configured for this exact catalog. Leave it empty to request the curated sources
directly; those publishers must allow browser access through CORS. The existing
Seattle Worker does **not** gain new permissions when a reader build changes.
It retains its own allowlist. Deploying or extending a feed service is a separate
operation.

In PowerShell, build an alternate site with:

```powershell
$env:READER_SITE_CONFIG = 'D:/path/to/my-reader/site.json'
npm run build:web
Remove-Item Env:READER_SITE_CONFIG
```

Use Node.js 24 or later. This reads only the explicitly named configuration; Vite
does not load a private `.env` file. `dist/` receives the reader, `catalog.json`,
`feeds.opml`, public assets, and third-party notices. A build does not publish
anything. Omit `READER_SITE_CONFIG` for the normal Sound & State build.

## Reader catalog

An alternate catalog uses the public reader contract; it does not need Seattle
editorial fields such as feed-health dates, README sections, or aliases:

```json
{
  "title": "Neighborhood sources",
  "repository": "example/neighborhood-reader",
  "categories": [
    {"id": "community", "title": "Community", "description": "Reporting and updates from community sources."}
  ],
  "feeds": [
    {
      "id": "community-updates",
      "name": "Community Updates",
      "website": "https://publisher.example/",
      "feed": "https://publisher.example/posts.json",
      "category": "community",
      "description": "Updates from a local community organization.",
      "kind": "posts",
      "format": "posts-json",
      "platform": "Community website",
      "redirects": []
    }
  ]
}
```

The optional `schemaVersion` is `1`; unknown versions are rejected. IDs use up to
120 lowercase letters, numbers, and hyphens. Keep IDs stable across renames
and endpoint changes. `kind` is `articles` or `posts`, independently of category
or social platform. New catalogs should always set it explicitly. Legacy entries
without `kind` remain articles, except the existing `bluesky` category.

`format` accepts `rss`, `atom`, `json-feed`, `posts-json`, or `auto`; the existing
`RSS` and `Atom` labels also work. `auto` detects RSS, Atom, and JSON Feed.
`posts-json` must be explicit. `platform` is optional descriptive text.
Categories can supply an optional `label` for a compact classification tag.
`redirects` contains verified exact HTTPS feed destinations; it is not a wildcard
or a request to fetch arbitrary URLs.

The build and browser both validate the catalog. Duplicate IDs and feed URLs,
unknown categories, unsupported kinds or formats, non-HTTPS destinations, and
embedded credentials are rejected. Catalogs are limited to 5,000 feeds and
1,000 categories. Content Security Policy permits connections only to the
configured service, curated feed origins, verified redirect origins, and the
reader's own origin. The emitted OPML includes each curated subscription URL;
another reader must support a JSON format to consume that subscription.

## JSON formats

[JSON Feed 1.1](https://www.jsonfeed.org/version/1.1/) and 1.0 use the standard
`version`, `title`, and `items` envelope. Each item needs a stable string `id`
and `content_text` or `content_html`. The reader preserves `date_published` and
`date_modified` independently, supports author names, resolves relative item
links against the source website, and does not invent missing dates. HTML is
sanitized by the same content pipeline used for RSS and Atom; text is escaped.
Remote images, embedded scripts, and tracking content cannot execute in stories.

The smaller curated-posts format is:

```json
{
  "version": 1,
  "posts": [
    {
      "id": "notice-42",
      "url": "https://publisher.example/notices/42",
      "text": "The community meeting starts at 6 p.m.\nEveryone is welcome.",
      "author": "Community Council",
      "published": "2026-09-17T18:00:00Z",
      "updated": "2026-09-17T19:00:00Z"
    }
  ]
}
```

`id` is required and must be a nonempty string. Provide `text` or `html` (or both;
HTML takes precedence). Optional `title`, `url`, `author`, `published`, and
`updated` must be strings. Without a title, a post uses the beginning of its text.
Linkless posts retain identity through their source ID and post ID. When a link
exists, the reader deduplicates its canonical URL across sources, as it does for
articles. If an article and a post share that identity, the article's content,
kind, and primary publisher take precedence regardless of arrival order. The
reader retains every contributing source ID and the existing read and saved marks.
A source response is capped at 5 MB and normalization reads at most
300 entries per response. Empty JSON item or post lists are valid successful
responses. Pagination, authenticated APIs, and arbitrary remote
JSON field mappings are not part of this contract; produce one of these two
documented JSON formats upstream.

Saved items carry their content kind even if the source leaves the catalog.
Legacy Sound & State backups remain readable. Changing a site's namespace
creates a separate library; export a reading backup before intentionally moving
an existing reader to another namespace or origin.
