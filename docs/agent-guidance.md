# Agent guidance for Sound & State

Research checked on 2026-09-15. This note explains the design; agents do not need to load it for ordinary repository tasks. Operational instructions live in [AGENTS.md](../AGENTS.md) and the linked skills.

## Decision

Keep one shared repository contract, a small Claude entry point, and three workflows that encode decisions specific to this project. Keep the critical constraints available even when skill selection fails. Use skills to help an agent carry out a task, and use the existing tests and CI to check the resulting software.

The useful information here is what an agent might otherwise get wrong: editing generated catalog files; running Node 20 against a Node 24 project; confusing local saved items with shared feed snapshots; treating one publisher refusal as a dead feed; weakening exact redirect restrictions; or describing browser storage more confidently than the implementation allows. A second inventory of every module would add little.

This is a repository-specific engineering judgment informed by the evidence below. It is not a claim that more instructions, shorter instructions, or skills universally improve coding performance.

## File responsibilities

| File or directory | Responsibility |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | Shared constraints, reader-writing rules, a compact source map, skill routing, and verification by change type. |
| [CLAUDE.md](../CLAUDE.md) | Import the shared instructions and explain the Claude adapters. No duplicate policy. |
| [.agents/skills/sound-state-catalog/](../.agents/skills/sound-state-catalog/) | Publisher evidence, stable IDs, aliases versus redirects, live checks, and source/generated output handling. |
| [.agents/skills/sound-state-reader/](../.agents/skills/sound-state-reader/) | Trace reader claims to code; verify UI, local persistence, shared Saved, accessibility, and failure states. |
| [.agents/skills/sound-state-feed-service/](../.agents/skills/sound-state-feed-service/) | Diagnose the delivery path and preserve request boundaries, cache rules, bounded work, and snapshot expiry. |
| [.claude/skills/](../.claude/skills/) | Discoverable Claude skills with matching names and descriptions, each directing Claude to read one canonical workflow. |
| [agent-guidance-validation.md](agent-guidance-validation.md) | Structural checks, discovery checks, realistic evaluation cases, and the limits of the initial validation. |
| [scripts/check_agent_guidance.py](../scripts/check_agent_guidance.py) | Repeatable offline checks for local links, skill metadata, and canonical/adapter routing; runs in CI. |

The project is small enough that nested instruction files would add loading differences and another maintenance surface without a clear benefit. Add one later only when a subtree needs materially different rules. Cross-cutting work can use two skills; each should add a distinct procedure.

## What the research supports

### Reconsider old scaffolding when models change

OpenAI's September 11, 2026 guidance recommends auditing accumulated instructions, making skill descriptions narrow, loading details only when relevant, and removing unnecessary reading or approval requirements. It also cautions that a repository serves contributors using different models. Here, descriptions name actual tasks, no model is pinned, and no mandatory planning ceremony, delegation, or unrelated audit precedes a small edit. Completion includes the checks relevant to the user's change. [OpenAI: Rethinking skills and prompts](https://learn.chatgpt.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra).

### Verify the host's loading rules

Codex discovers repository instructions along the path from the project root to the working directory; its documented default aggregate limit is 32 KiB. That limit is a ceiling, not a writing target. Keeping the shared rules at the root avoids depending on discovery of instructions below the launch directory. [Codex: AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

Claude Code documents `@AGENTS.md` as the way to share these rules. Its imports load into context, so importing every skill from `CLAUDE.md` would defeat selective loading. The existing draft's import approach is worth keeping. [Claude Code: project memory and imports](https://code.claude.com/docs/en/memory#agentsmd).

Codex documents `.agents/skills/`; Claude documents `.claude/skills/`. A common skill format does not make those discovery paths interchangeable. The adapters are this repository's portability choice: they use ordinary files and explicit relative links, avoiding Windows symlink setup and duplicated workflow bodies. The remaining duplicated metadata must stay aligned. [Codex skill discovery](https://learn.chatgpt.com/docs/build-skills), [Claude skill discovery](https://code.claude.com/docs/en/skills).

The skills use the standard `name` and `description` fields, with names matching directory names. They do not rely on host-specific shell interpolation, permission metadata, subagent configuration, or automatic Markdown import expansion inside a skill. An adapter tells the agent to read a file; it is not a special import mechanism. [Agent Skills specification](https://agentskills.io/specification).

### Put procedures behind precise triggers

Anthropic recommends keeping broadly applicable context concise and moving occasional workflows into skills. Its context-engineering guidance favors retrieving relevant information when needed. Here, a reader skill points to storage logic only for persistence work; a wording change does not trigger a whole-repository audit. Selection criteria stay in `.github/CONTRIBUTING.md`, schemas stay in JSON, and commands stay defined in `package.json`. [Claude Code best practices](https://code.claude.com/docs/en/best-practices#write-an-effective-claudemd), [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

Vercel's June 25, 2026 account separates routing, procedures, supporting evidence, and evaluation. It explicitly distinguishes failure to load a skill from failure to follow its instructions. That distinction informs the root routing table and the separate discovery and outcome checks here. Its product-design system is much larger than this reader needs, so this implementation does not copy its layers or tooling. [Vercel: Teaching agents product design](https://vercel.com/blog/teaching-agents-product-design-at-vercel).

### Keep mandatory constraints outside optional skill activation

In Vercel's January 27, 2026 Next.js evaluation, an available skill went unused in 56% of cases; a compact instruction-file documentation index performed better. That is evidence of a possible routing failure, not proof that every project should embed framework documentation. This repository uses vanilla browser modules, and its existing source is the best local reference. Privacy, generated-file handling, and verification requirements therefore remain in the shared root instructions even though skills elaborate their application. [Vercel's evaluation](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals).

### Measure outcomes rather than instruction volume

Recent empirical results disagree in ways that matter:

| Primary study | Result and limit | Application here |
| --- | --- | --- |
| [Gloaguen et al., revised June 23, 2026](https://arxiv.org/html/2602.11988v2) | Context files did not generally improve issue resolution and increased inference cost by over 20% on average. The study's Python tasks and agent configurations do not establish this JavaScript reader's outcome. | Avoid generic generated overviews and unnecessary exploration. Evaluate changes to guidance. |
| [Lulla et al., revised March 30, 2026](https://arxiv.org/abs/2601.20404v2) | A paired study of 124 PRs across 10 repositories associated instruction files with lower median runtime and output-token use. Efficiency and task-resolution evidence answer different questions. | Track effort as well as correctness; do not claim instructions always slow agents down. |
| [Shepard and Albrecht, revised June 19, 2026](https://arxiv.org/html/2606.20512v2) | Probe-refined guidance improved resolution over static and unguided baselines in their main experiment; a different model exposed limits to the tuning process. | Refine from observed task failures, and retest after tool or model changes. Do not transfer the paper's percentages to this repository. |

These studies support an evaluation discipline, not a universal winning template. The supplied cases are a starting rubric; they are not a measured benchmark result.

## Public Discord research

Research used paced searches for `AGENTS.md`, `CLAUDE.md`, skills, nested discovery, and reload behavior in publicly indexed Discord material. Direct Discord access reached a sign-in screen; the requester chose public discussions. No authenticated community or private message was read, and no message was posted.

Two accessible Answer Overflow mirrors from The Shitty Coders Club provided concrete reports:

- A participant reported that Codex needed to start in the subdirectory to discover its instruction file. The official Codex discovery documentation above, rather than the post alone, supports keeping shared guidance at the root. [Public Discord post: nested discovery](https://www.answeroverflow.com/m/1478724922430980106).
- Another participant reported that a reload command did not reload the included `AGENTS.md`. The short public excerpt does not establish the host or version, so this is only a reason to check instructions in a fresh session, not a Codex or Claude compatibility claim. [Public Discord post: reload behavior](https://www.answeroverflow.com/m/1482070739229348003).

Other search results included OpenClaw-specific memory conventions and broad claims about skill loading. Some mirrors returned incomplete content, and browser access encountered a security checkpoint. Those results did not establish transferable Codex or Claude behavior and did not become repository rules. This is a limited public-index sample, not a comprehensive survey of Discord communities. Vendor documentation establishes loading behavior; public discussions help identify questions to verify.

## Maintain the system as the repository changes

- Review an instruction change with the behavior it governs. A changed npm command, renamed file, storage guarantee, or deployment path can make a previously accurate instruction wrong.
- Keep evidence and rationale here, workflow steps in the canonical skill, and universal constraints in `AGENTS.md`. Do not make every task read this research note.
- Correct a recurring observed failure at its narrowest useful location. Remove obsolete instructions instead of continually appending exceptions. Do not convert session transcripts or personal auto-memory into shared rules without review.
- Check skill triggers with positive and negative examples. Check outputs separately from whether the skill loaded. Record host/version and limitations rather than assuming Codex and Claude behave identically.
- Prefer the existing schema, deterministic tests, and CI for enforceable behavior. Instruction text is advisory context, not a security boundary. The PR review identified a reproducibility gap in the original structural checks; the checked-in checker now addresses that gap. Add further tooling only for an observed need; this change adds neither production permissions nor automatic deployment.

See [the validation procedure and initial results](agent-guidance-validation.md) before changing this design or claiming a productivity improvement.
