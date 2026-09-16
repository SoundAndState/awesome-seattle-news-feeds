# Repository instructions

These instructions apply throughout this repository. Keep shared agent guidance in this file; `CLAUDE.md` imports it. Read [CONTRIBUTING.md](CONTRIBUTING.md) for feed selection criteria and the contribution process.

## Project structure

Sound & State is a browser-based news reader and a curated catalog of Seattle-area RSS and Atom feeds.

- `feeds.json` is the source of truth for the catalog; `feeds.schema.json` defines its structure.
- `scripts/render.mjs` and `scripts/build.mjs` generate `readme.md` and `feeds.opml`. Change the source or generator, never the generated files by hand. For feed-only pull requests, submit the catalog change; GitHub Actions generates and commits the published files after merge.
- `web/index.html` contains the reader shell and About text. `web/src/` contains the browser behavior, dynamic messages, and styles.
- `proxy/` contains the Cloudflare feed service, caching rules, and backup-feed handling.
- `site.config.json` contains the site metadata and service URL. `vite.config.mjs` builds the reader and its public assets into `dist/`.
- `tests/*.test.mjs` covers catalog and application logic. `tests/browser/reader.spec.mjs` covers desktop Chromium and mobile WebKit. `tests/*_test.py` covers the feed health tools.
- `.github/workflows/validate.yml` defines CI checks; `.github/workflows/pages.yml` handles publication.

## Working conventions

- Inspect the current changes before editing and preserve work outside the requested task.
- Use the existing JavaScript ES modules, two-space indentation, and browser APIs. Match nearby code and keep changes focused.
- Keep reading history, saved items, and preferences in the browser. Preserve feed requests that omit cookies, credentials, and referrers, and preserve content sanitization and connection restrictions.
- Check user-facing claims against the implementation. Update the relevant explanation when behavior changes.
- Keep credentials out of source files, generated assets, logs, and commits. Local deployment reads `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from the environment or ignored `.env`; the frontend build must not load that file.

## Writing for readers

Use active, direct language throughout the reader, including help text, errors, status messages, and screen-reader announcements. Use the same voice when explaining work to the user.

- Name who does what: the reader stores items, your browser sends requests, and the publisher controls access to its feed. Avoid passive sentences that hide the actor.
- Describe concrete information and actions. Say "which items you have read" instead of "reading state," and explain that the reader tries a previously saved copy instead of saying "cached fallback."
- Explain conditions and consequences in separate sentences. Say when the reader retries, who it contacts, and what can prevent the retry from working.
- For failures, say what the reader could not do, what the user can still access, and what they can try next. Do not claim a specific cause unless the reader can establish it.
- Start button labels with the action and refer to the same label in instructions. Keep familiar navigation and metadata labels short, such as Saved, Published, and Updated.
- Use technical terms only when they help readers understand a limit or make a choice. Explain a term before introducing its abbreviation.
- Check every claim against the behavior, including exceptions for unavailable storage, offline use, and backups. Preserve those limits when simplifying the wording.

## Setup and verification

Use Node.js 24 or newer, consistent with `.nvmrc` and `package.json`. Check the active runtime before running commands; an older system installation may appear first on `PATH`. Use `npm ci` when dependencies need installation. Use Python 3.12 or newer for feed health tools.

Run checks that match the change:

- **Documentation and agent instructions:** verify local links, file references, and documented commands. Application tests are unnecessary when only Markdown changes.
- **JavaScript behavior:** run `npm test`.
- **Reader UI or copy:** run `npm run build:web`, then `npm run test:browser`. Install missing browsers with `npx playwright install chromium webkit`. Check longer text in phone and desktop layouts, including expanded dialogs.
- **Catalog or generation:** run `npm run ci` to generate and check the published files, validate the catalog, lint the README and OPML, run unit tests, and build the reader. Review generated differences without hand-editing them.
- **Cloudflare feed service:** run `npm test` and `npx wrangler deploy --dry-run` to check the Worker bundle.
- **Python feed health tools:** run `python -m unittest discover -s tests -p '*_test.py'`. Use `npm run check:feeds` when the task calls for live publisher checks.

Run `git diff --check` before finishing. Report what changed, which checks passed, and any checks you could not complete. Keep tests focused on behavior; do not add tests that merely duplicate wording for a routine copy edit.
