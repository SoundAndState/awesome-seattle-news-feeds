# Validate repository agent guidance

Use this procedure when changing the instruction system. It separates file validity, host discovery, task routing, and software outcomes. Ordinary application work follows the verification matrix in [AGENTS.md](../AGENTS.md).

## Choose checks by change type

Combine only the rows that apply. A typo, repaired link, or research citation does not require a model evaluation.

| Change | Required checks |
| --- | --- |
| Any instruction, skill, adapter, or guidance-document edit | Run the structural checker below, inspect the diff, and run `git diff --check`. |
| Checker implementation or dependency changes | Also run the Python tests, including the checker fixtures. |
| Entry-point addition, removal, rename, import, or adapter target change; agent-host upgrade | Also run discovery checks in each affected host and a read-only invocation that confirms the canonical file was read. If a host is unavailable, record that gap. |
| Skill description, routing rule, workflow step, decision boundary, or verification requirement changes | Also exercise an affected task case and a nearby case that should not trigger the changed behavior. Preserve the prompt and relevant trace with the review evidence. A full comparison is not required. |
| Redesign of instruction ownership or loading, adoption of a new agent/model configuration, or a productivity/correctness claim | Also compare representative tasks before and after the change under controlled conditions. Use a held-out task and repeat variable outcomes. |

The task-case and comparison rows concern how agents perform repository tasks. Changes limited to this validation policy need structural review; checker implementation or dependency changes also need Python tests. Validation-policy maintenance does not require model runs to evaluate itself.

## Structural review

Use Python 3.12 or newer. Install the pinned checker dependency in your active Python environment, then run these commands from the repository root:

```text
python -m pip install -r scripts/requirements-agent-guidance.txt
python scripts/check_agent_guidance.py
git diff --check
```

`npm run check:agents` runs the same checker with the active `python`. [The checker](../scripts/check_agent_guidance.py) reads `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/agent-guidance*.md`, and Markdown files beneath both skill directories. It checks inline relative Markdown links and ATX heading anchors outside fenced examples, parses skill YAML, validates required metadata, compares canonical/adapter names and descriptions, checks root routes and the Claude import, and checks documented `npm run` script names. It makes no network requests and edits no files. External URLs, reference-style links, and host/model behavior need separate review.

Keep procedures in the canonical skill. Manually verify browser setup against [playwright.config.mjs](../playwright.config.mjs), Python flags against `python scripts/check_feeds.py --help`, and deployment commands against scripts and workflows. Inspect definitions without publishing or contacting every feed merely to validate documentation. Review the staged diff for credentials, personal configuration, evaluation outputs, generated catalog files, and unrelated work.

The [validation workflow](../.github/workflows/validate.yml) installs [the pinned dependency](../scripts/requirements-agent-guidance.txt) and runs this check separately from `npm run ci`. Its existing Python test step also exercises [the checker's fixtures](../tests/agent_guidance_test.py). For checker changes, run `python -m unittest discover -s tests -p '*_test.py'`. Markdown-only edits do not require application tests or rerunning the unchanged checker fixtures.

## Discovery smoke check

Start a fresh session at the repository root after changing instruction entry points. Record the installed agent version. In Codex CLI, use `/skills` to inspect the three `sound-state-*` entries. In Claude Code, use `/context` to inspect the imported instructions and the `/` menu to inspect the three skills. Confirm the paths belong to this checkout rather than a personal skill with a similar name. See [Codex skills](https://learn.chatgpt.com/docs/build-skills) and [Claude project memory](https://code.claude.com/docs/en/memory).

Explicitly invoke one skill with a read-only request to list the sources and checks it would use. Confirm it reads the canonical workflow, including when invoked through a Claude adapter. Repeat discovery from `web/` when testing a host upgrade, since launch-directory differences can matter. Do not assume a self-report alone proves discovery: inspect the host's skill listing or file-read trace.

For the outstanding Claude adapter check, start a fresh Claude Code session in this checkout and submit:

```text
/sound-state-reader Review which source files and checks would be relevant to
clarifying the browser-storage failure warning. Read the necessary guidance and
source files, then report your findings. Do not edit files or execute commands.
```

Keep the Claude version, repository commit, exact prompt, skill listing, and relevant file-read trace with the PR evidence. The trace must show the adapter loading `.agents/skills/sound-state-reader/SKILL.md`; the findings should trace the warning to the reader's storage behavior and identify the relevant checks. A plausible answer without that read trace does not close the adapter handoff gap. Record a failed or unavailable run as such; do not infer success from Codex discovery.

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

When the change-type table calls for a broader comparison, run representative cases with and without the change using the same repository revision, agent version, model, prompt, permissions, fixtures, and budget. Use separate fresh sessions and keep expected answers out of agent context. Repeat variable outcomes; keep at least one task out of the refinement loop to check generalization.

Record task completion and correctness, relevant tests, selected skills and files read, unauthorized or unrelated actions, unnecessary checks, human corrections, elapsed time, and token use when the host exposes it. A shorter file is not success if it causes an incorrect edit; successful discovery is not proof of good task behavior. Update a rule only when the observations justify it.

## Initial validation

Checked on 2026-09-15 against the initial implementation at `b6105b7` (before adding the repeatable checker):

- All six skill entry points passed the skill-creator's `quick_validate.py`. A separate structural check confirmed three matching canonical/adapter metadata pairs, the root routes, and the Claude import.
- A local-link check passed for all 75 links and anchors across the 11 guidance and contribution files. Referenced npm commands exist in `package.json`; the Python CLI confirmed the documented targeted-check flags. Workflow and browser configuration inspection confirmed the verification matrix.
- A fresh Codex CLI 0.114.0 app-server process returned all three canonical skills as enabled with repository scope through `skills/list`, both for the repository root and `web/`, with no repository skill errors. This check made no model request and did not start a coding task.
- The root instructions contain 64 lines. Each canonical skill contains 30-36 lines; each Claude adapter contains six. These are review measurements, not quality thresholds or performance results.
- `git diff --check` passed. Application tests were not run locally because the change contains Markdown only; the existing PR workflow remains responsible for its full checks.

Claude Code was not installed, so its native discovery and adapter-following behavior remain untested locally. The adapter structure and import syntax were checked against its current documentation. The task cases above have not been run as independent agent evaluations, and no before/after productivity or correctness gain is claimed. Use them to evaluate future changes and the first real tasks after adoption.

The review follow-up keeps that Claude limitation open, supplies the concrete smoke test above, and preserves structural validation as a repository command. The checker's fixture tests cover valid input, broken targets and headings, missing or mismatched metadata, missing adapters, missing routes/imports, unknown npm scripts, and links outside the checkout. Their results establish checker behavior, not agent task performance.
