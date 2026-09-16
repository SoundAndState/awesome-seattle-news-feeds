# Repository instructions

These instructions apply throughout this repository. Keep shared agent guidance in this file; `CLAUDE.md` imports it. Read [CONTRIBUTING.md](.github/CONTRIBUTING.md) for feed selection criteria and the contribution process.

## Project structure

Sound & State is a browser-based news reader and a curated catalog of Seattle-area RSS and Atom feeds.

- `data/feeds.json` is the source of truth for the catalog; `data/feeds.schema.json` defines its structure.
- `scripts/render.mjs` and `scripts/build.mjs` generate `readme.md` and `feeds.opml`. Change the source or generator, never the generated files by hand. For feed-only pull requests, submit the catalog change; GitHub Actions generates and commits the published files after merge.
- `web/index.html` contains the reader shell and About text. `web/src/` contains the browser behavior, dynamic messages, and styles.
- `proxy/` contains the Cloudflare feed service, caching rules, and backup-feed handling.
- `config/site.config.json` contains the site metadata and service URL. `config/vite.config.mjs` builds the reader and its public assets into `dist/`.
- `config/playwright.config.mjs` configures browser tests; `config/wrangler.jsonc` configures the feed service. Use the npm commands below so each tool loads its configuration from `config/`.
- `tests/*.test.mjs` covers catalog and application logic. `tests/browser/reader.spec.mjs` covers desktop Chromium and mobile WebKit. `tests/*_test.py` covers the feed health tools.
- `.github/CONTRIBUTING.md` and `.github/code-of-conduct.md` describe how to contribute.
- `.github/workflows/validate.yml` defines CI checks; `.github/workflows/pages.yml` handles publication.

Keep the generated `readme.md` and `feeds.opml` at the root so GitHub displays the catalog and existing OPML download links keep working. Keep package manifests, agent entry points, the license, and repository-wide dotfiles at the root for tool discovery.

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

## Describing publishers and communities

The purpose of catalog descriptions is to help readers understand each source's work, audience, and role with respect and consistent standards. Follow the reusable [publisher-description review process](docs/publisher-description-review.md) when adding feeds or auditing existing descriptions. The [September 2026 inventory](docs/feed-description-audit-2026-09-15.md) records the evidence and decisions for all 119 feeds reviewed then.

- Start with the publisher's About page, mission, section description, or account bio. Record the source URL and review date in editorial notes. Use supported community names and professional roles; do not invent identity or viewpoint labels.
- Distinguish audience, coverage, authorship, ownership, geography, and editorial perspective. Do not infer a person's or organization's identity from names, photographs, neighborhoods, or reporting topics. Preserve relevant self-identification and community agency rather than erasing them.
- Paraphrase concisely. Do not repeat promotional superlatives or treat a publisher's claims of independence or neutrality as verified facts. Distinguish quoted language from editorial summaries.
- Describe reporting, analysis, opinion, advocacy, official announcements, marketing, and satire consistently across comparable sources. Name relevant institutional relationships. A cultural mission alone does not turn reporting into advocacy; official or commercial status does not establish neutrality.
- Review the same publisher across its website and social feeds together. Check categories as well as descriptions, and keep community-serving newsrooms alongside comparable reporting sources.
- For full audits, inventory every feed ID, category description, and auxiliary resource. Separate supported corrections, optional refinements, unchanged entries, and evidence gaps. Assess wording and framing without claiming to know subconscious intent.
- Resolve evidence gaps through other publisher-controlled sources when possible. Otherwise record the limitation and avoid unsupported replacements. Keep description-review dates separate from feed-health `checkedOn` dates.
- Apply approved wording in `data/feeds.json`, preserve unrelated catalog fields, and run the catalog and reader-copy checks below. Inspect generated differences; let the publication workflow commit the compiled README and OPML.

## Setup and verification

Use Node.js 24 or newer, consistent with `.nvmrc` and `package.json`. Check the active runtime before running commands; an older system installation may appear first on `PATH`. Use `npm ci` when dependencies need installation. Use Python 3.12 or newer for feed health tools.

Run checks that match the change:

- **Documentation and agent instructions:** verify local links, file references, and documented commands. Application tests are unnecessary when only Markdown changes.
- **JavaScript behavior:** run `npm test`.
- **Reader UI or copy:** run `npm run build:web`, then `npm run test:browser`. Install missing browsers with `npx playwright install chromium webkit`. Check longer text in phone and desktop layouts, including expanded dialogs.
- **Catalog or generation:** run `npm run ci` to generate and check the published files, validate the catalog, lint the README and OPML, run unit tests, and build the reader. Review generated differences without hand-editing them.
- **Cloudflare feed service:** run `npm test` and `npm run check:proxy` to check the Worker bundle.
- **Python feed health tools:** run `python -m unittest discover -s tests -p '*_test.py'`. Use `npm run check:feeds` when the task calls for live publisher checks.

Run `git diff --check` before finishing. Report what changed, which checks passed, and any checks you could not complete. Keep tests focused on behavior; do not add tests that merely duplicate wording for a routine copy edit.
