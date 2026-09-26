# Edit the reader's English text

Edit [`web/src/locales/en.json`](../web/src/locales/en.json) to customize the
reader's interface. It contains navigation and button labels, search hints,
dialogs, help, announcements for screen readers, loading and error messages,
backup messages, CSV headings, and the no-JavaScript notice. The `site` group
also contains Sound & State's brand, page metadata, category labels, and About
disclosures. The reader currently ships only this English file; there is no
language selector or translation service.

## Find and edit text

Search the file for the wording you see in the app. Related text is grouped by
feature, such as `search`, `loading`, `reading`, `preview`, and `help`. Shared
labels live in `common`. Edit the values and keep the keys unchanged. For example:

```json
"clear": "Clear search"
```

Some actions also appear in accessibility labels and help paragraphs. Search for
the old label throughout the file and update those references when you rename
an action. JSON requires double quotes, escaped quotes inside strings, and no
trailing commas. Use ordinary punctuation, including `&`, rather than HTML
entities such as `&amp;`.

## Keep placeholders and count variants

Messages use named placeholders for values supplied by the reader:

```json
"previewLabel": "Preview article: {title}"
```

You can move `{title}` within the sentence or repeat it. Keep its spelling and
braces; do not introduce new placeholder names. The reader substitutes values
once, so an article title containing braces stays literal text.

Counts that need different wording have complete `one` and `other` messages:

```json
"articles": {
  "one": "Show {count} new article",
  "other": "Show {count} new articles"
}
```

Edit both variants. English uses `other` for zero as well as counts greater than
one. The `locale` setting controls number and date formatting; `language` and
`socialLocale` set the page and sharing metadata. Leave these set to English
while customizing English copy.

Text is rendered as text, not HTML. A few help messages have placeholders such
as `{filename}`, `{hash}`, `{prefix}`, and `{download}` for a formatted filename,
code fragment, or link. Preserve those placeholders to keep the existing markup
and link behavior. Do not put HTML tags in the JSON.

## Scope and configuration

[`config/site.config.json`](../config/site.config.json) selects the default copy
with `"copy": "en"`. Operational settings, including URLs, capabilities, assets,
and the browser database name, stay in that configuration. Alternate reader
configurations can supply their own brand and About text without opting into
Sound & State's `site` copy; see [reader configuration](reader-configuration.md).

Publisher names, catalog descriptions, article content, and diagnostic text
returned by publishers or dependencies remain data from their existing sources.
Third-party licenses and text embedded in image assets also stay with those
assets. Route names, backup fields, and legacy item-identity tokens are stable
technical values, not editable interface copy. Changing a fallback title in the
English file preserves existing article IDs and read marks.

## Preview and verify

From the repository root, with Node.js 24 or later:

```sh
npm run build:web
npm run preview
```

Open the local address printed by the preview command. Copy is bundled at build
time, so rebuild after edits. A build does not publish the site.

For copy edits, run `npm run test:browser` after rebuilding and inspect affected
phone and desktop views, including long text and expanded dialogs. Existing
browser tests use English accessible names; update relevant expectations when
intentionally changing those names. Run `npm test` when changing message helpers
or other JavaScript behavior, and finish with `git diff --check`.
