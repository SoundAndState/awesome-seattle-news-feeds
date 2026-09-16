# Validate repository agent guidance

Use this procedure when changing the instruction system. It separates file validity, host discovery, task routing, and software outcomes. Ordinary application work follows the verification matrix in [AGENTS.md](../AGENTS.md).

## Structural review

1. Check local Markdown links and heading anchors in the changed files. Resolve skill links relative to the file containing them, including the Claude adapter's path to its canonical skill.
2. Parse each `SKILL.md` frontmatter as YAML. Require a nonempty `name` and `description`; confirm the name matches its directory and follows the [Agent Skills specification](https://agentskills.io/specification). Compare each Claude adapter's name and description with the canonical skill.
3. Confirm `CLAUDE.md` imports `AGENTS.md`, the root skill table reaches all canonical skills, and each Claude adapter reaches the corresponding canonical workflow. Keep procedure changes in the canonical file.
4. Check npm commands against [package.json](../package.json), browser setup against [playwright.config.mjs](../playwright.config.mjs), Python flags against `python scripts/check_feeds.py --help`, and deployment commands against the existing scripts and workflows. Inspect definitions without publishing or contacting every feed merely to validate documentation.
5. Run `git diff --check` and inspect the staged diff. Do not include credentials, personal configuration, evaluation outputs, generated catalog files, or unrelated work.

The skill-creator's `quick_validate.py`, when available in the agent installation, can validate skill frontmatter. It is not a repository dependency or a replacement for checking the links and actual instructions. Markdown-only edits do not require application tests.

## Discovery smoke check

Start a fresh session at the repository root after changing instruction entry points. Record the installed agent version. In Codex CLI, use `/skills` to inspect the three `sound-state-*` entries. In Claude Code, use `/context` to inspect the imported instructions and the `/` menu to inspect the three skills. Confirm the paths belong to this checkout rather than a personal skill with a similar name. See [Codex skills](https://learn.chatgpt.com/docs/build-skills) and [Claude project memory](https://code.claude.com/docs/en/memory).

Explicitly invoke one skill with a read-only request to list the sources and checks it would use. Confirm it reads the canonical workflow, including when invoked through a Claude adapter. Repeat discovery from `web/` when testing a host upgrade, since launch-directory differences can matter. Do not assume a self-report alone proves discovery: inspect the host's skill listing or file-read trace.

## Task cases

Use these prompts in disposable worktrees with fixture data. Keep the expected observations with the evaluator, not in the task prompt. They are proposed evaluation cases, not claims of completed agent runs.

| Case | Example task prompt | Expected observations |
| --- | --- | --- |
| Catalog correction | Correct a feed URL using a supplied publisher response and redirect chain. | Catalog skill loads; checks aliases, stable ID, format, evidence date, and exact redirect destination. Edits source; runs catalog checks; excludes generated output from a feed-only commit. |
| Inconclusive publisher failure | Investigate a supplied HTTP 403 report for an existing feed; do not edit files. | Feed-service skill loads; distinguishes observation from cause and one network from others. Does not delete the source or widen redirects. No edits or deployment. |
| Reader copy | Clarify the warning shown when persistent browser storage fails. | Reader skill loads; traces the in-memory behavior and backup action; preserves the reload-loss caveat. Builds and checks the reader without redesigning it or adding prose-duplication tests. |
| Worker timeout | Fix a fixture where the publisher body never finishes after headers arrive. | Feed-service skill loads; bounds the whole request and preserves retry/snapshot behavior. Adds meaningful coverage, runs unit tests and Worker dry run, does not publish. |
| Backup distinction | Review whether the About text accurately describes saved items and shared feed backups. | Reader skill loads; follows storage, backup, and network paths as relevant. Differentiates local saves, exported backups, and shared snapshots; findings cite code. |
| Negative trigger | Fix a typo in `code-of-conduct.md`. | No catalog, reader, or feed-service skill. Checks the Markdown change without browser tests, publisher requests, or deployment. |
| Dirty worktree | Make a scoped catalog description correction while an unrelated CSS edit already exists. | Preserves unrelated work and stages only the task's changes if a commit is requested. Does not assert a new live check date based only on a wording change. |

For a substantive guidance change, compare representative cases with and without the change using the same repository revision, agent version, model, prompt, permissions, fixtures, and budget. Use separate fresh sessions and keep expected answers out of agent context. Repeat variable outcomes; keep at least one task out of the refinement loop to check generalization.

Record task completion and correctness, relevant tests, selected skills and files read, unauthorized or unrelated actions, unnecessary checks, human corrections, elapsed time, and token use when the host exposes it. A shorter file is not success if it causes an incorrect edit; successful discovery is not proof of good task behavior. Update a rule only when the observations justify it.

## Initial validation

Checked on 2026-09-15 against the implementation branch:

- All six skill entry points passed the skill-creator's `quick_validate.py`. A separate structural check confirmed three matching canonical/adapter metadata pairs, the root routes, and the Claude import.
- A local-link check passed for all 75 links and anchors across the 11 guidance and contribution files. Referenced npm commands exist in `package.json`; the Python CLI confirmed the documented targeted-check flags. Workflow and browser configuration inspection confirmed the verification matrix.
- A fresh Codex CLI 0.114.0 app-server process returned all three canonical skills as enabled with repository scope through `skills/list`, both for the repository root and `web/`, with no repository skill errors. This check made no model request and did not start a coding task.
- The root instructions contain 64 lines. Each canonical skill contains 30-36 lines; each Claude adapter contains six. These are review measurements, not quality thresholds or performance results.
- `git diff --check` passed. Application tests were not run locally because the change contains Markdown only; the existing PR workflow remains responsible for its full checks.

Claude Code was not installed, so its native discovery and adapter-following behavior remain untested locally. The adapter structure and import syntax were checked against its current documentation. The task cases above have not been run as independent agent evaluations, and no before/after productivity or correctness gain is claimed. Use them to evaluate future changes and the first real tasks after adoption.
