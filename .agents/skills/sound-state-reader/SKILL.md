---
name: sound-state-reader
description: "Change or review Sound & State reader behavior, layout, accessibility, and user-facing text. Use for reader UI and browser-state work, not catalog-only or backend-only changes."
---

# Change the reader

Identify the affected user action and observable outcome. Keep a copy edit within its requested scope; for review-only work, report findings. Run commands from the repository root and follow [the writing guidelines](../../../AGENTS.md#writing-for-readers).

## Read the relevant implementation

Use these entry points selectively; a label change does not require reading every module.

| Affected behavior | Entry points |
| --- | --- |
| Shell, About, dialogs, dynamic messages | [web/index.html](../../../web/index.html), [main.mjs](../../../web/src/main.mjs) |
| Layout and typography | [style.css](../../../web/src/style.css), [typography.css](../../../web/src/typography.css) |
| Articles, Posts, shared Saved, routes | [reader-state.mjs](../../../web/src/reader-state.mjs), [navigation.mjs](../../../web/src/navigation.mjs) |
| Persistence, backup import/export | [storage.mjs](../../../web/src/storage.mjs), [export.mjs](../../../web/src/export.mjs), backup handlers in `main.mjs` |
| Feed retries, normalization, content safety, dates | [network.mjs](../../../web/src/network.mjs), [feeds.mjs](../../../web/src/feeds.mjs), [content.mjs](../../../web/src/content.mjs), [dates.mjs](../../../web/src/dates.mjs) |

## Preserve the affected user contract

- Keep Articles and Posts distinct and Saved shared. When changing filters or routing, check old links, back/forward navigation, and saved items whose source has left the catalog.
- Distinguish browser-stored items, Cloudflare's shared backup feeds, and exported reading backups. They have different availability and persistence limits. Trace the relevant code before saying that something is saved, offline, current, or recoverable.
- For network text, check the proxy-first request and direct publisher retry in `network.mjs`. Do not diagnose a browser network failure as a confirmed publisher block. For storage text, account for the in-memory fallback and loss of new changes on reload.
- For content changes, preserve sanitization and safe links. Feed HTML must not execute scripts or load publisher trackers. For date changes, preserve the distinction between publication and update times and do not invent absent dates or times.
- For dialogs and controls, preserve accessible names, keyboard operation, focus restoration, touch usability, and navigation state. Check only states the affected feature can actually reach.

## Verify the result

Run `npm test` for JavaScript behavior changes. For UI or copy edits, run `npm run build:web` before `npm run test:browser`; Playwright previews the built output. [playwright.config.mjs](../../../config/playwright.config.mjs) defines desktop Chromium, Firefox, and WebKit, plus Android-sized Chromium and iPhone-sized WebKit. Install missing browsers with `npx playwright install chromium firefox webkit`.

Use the feed fixtures and request interception in [tests/browser/reader.spec.mjs](../../../tests/browser/reader.spec.mjs) for reproducible scenarios. Do not turn browser tests into live publisher checks. Exercise the changed state, long text, phone and desktop layouts, and relevant expanded dialogs. Inspect the rendered result when layout changes; source inspection alone is not visual verification.

Update behavior tests when behavior changes. For routine copy edits, update existing accessible-name expectations if needed without adding assertions that merely duplicate prose. Report what you exercised, check results, and any visual or browser checks you could not run.
