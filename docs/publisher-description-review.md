# Reviewing publisher descriptions

## Purpose

Help readers understand what each source publishes, whom it serves, and which institution or person produces it. Use publishers' own language for relevant identities and roles, and apply the same editorial standards to community newsrooms, established media, advocates, businesses, and public agencies.

A description review can identify omissions, unsupported claims, and uneven framing. It cannot establish an author's subconscious intent or certify a publisher as unbiased. Self-description establishes how a publisher presents itself; it does not independently prove every claim the publisher makes.

## When to use this process

Use this process when adding a source, changing a description, responding to a publisher correction, or auditing the catalog. Review the affected publisher across all its channels for a single change. For a full audit, include every feed, category title and description, and auxiliary resource. Do not select only sources with racial, cultural, or political missions.

## Process

The reusable procedure lives in the canonical [catalog skill](../.agents/skills/sound-state-catalog/SKILL.md#review-descriptions-fairly), which both Codex and the Claude adapter use. It covers source research, identity and agency, comparisons across publishers, recommendation categories, completeness, implementation, and verification. Read that section for description work; a URL-only correction does not by itself trigger a catalog-wide wording audit.

## Evidence record

Keep a dated review in `docs/` with this information for each affected feed. A full audit must also include entries that stay unchanged.

| Field | What to record |
| --- | --- |
| Feed ID and category | Stable ID and existing placement. |
| Description before review | Exact catalog wording. |
| Publisher evidence | Primary-source URL, access date, scope, and a short paraphrase or clearly marked brief quotation. |
| Assessment | Specific omission, source mismatch, framing concern, or reason to retain the wording. |
| Recommendation | Keep, Revise, Refine, or Verify; the complete proposed sentence when applicable. |
| Limitations | Retrieval failures, dated sources, unresolved claims, or sample limits. |
| Implementation | Final wording or a reference to the accepted proposal, date, and reasons for any departure. |

Do not store access tokens, private profile data, full copyrighted pages, or unnecessary personal details in the record. Keep short excerpts within applicable quotation limits.

## September 2026 application

The [complete audit](feed-description-audit-2026-09-15.md) covers 119 feeds, 13 categories, and four archive links. The implementation applies 38 description changes: 14 corrections, 23 refinements, and the Real Change proposal after resolving its evidence gap through its own organizational profile and public post. It also clarifies the category title to “Food, Culture, and History.” The other 81 descriptions remain unchanged.

The changes restore Pacific Islander inclusion, follow publishers' preferred identity terms, recognize community and vendor agency, name Tribes among smoke-information partners, and make genre and institutional roles more consistent. They do not claim that the previous authors intended discrimination. The catalog skill owns the reusable procedure, this document supplies the purpose and evidence template, and the shared AGENTS entry preserves the editorial principles. The dated audit records the source evidence and individual decisions.

## Procedure validation

The September 15 implementation exercised the affected task and a nearby case in an isolated checkout. These are manual procedural checks and catalog comparisons, not independent model evaluations or claims about automatic skill discovery. Skill names, descriptions, entry points, and adapter targets did not change.

| Case | Prompt and relevant execution trace | Result |
| --- | --- | --- |
| Description audit and implementation | User request: “Look through each and every feed, making a thorough inventory of their descriptions and an evaluation of their descriptions for bias or subconscious discrimination,” followed by “Implement your recommendations now.” The review read publisher pages and all 27 public profile records, recorded evidence per ID, resolved the Real Change limitation, and compared the accepted catalog with the starting snapshot. | 119 unique IDs reviewed; 38 descriptions changed exactly to the accepted proposals; every other feed field preserved. The dated audit retains the evidence, original text, and decisions. |
| Nearby URL-only correction | Fixture prompt: “Correct the supplied feed URL only; preserve descriptions and dates.” A disposable in-memory catalog copy changed one feed address to `https://publisher.example/updated.rss`; the comparison checked the changed keys, all descriptions, and all feed-health dates. No publisher request or description review ran for this fixture. | Only the requested address changed. The description-review procedure did not expand this walkthrough into a catalog-wide wording audit. This fixture does not establish that the example address is a live feed. |

The repository guidance checker and the skill-creator validator passed. Local link checks covered the evidence record and audit as well as the shared instructions. The catalog checks passed, and the pull request records browser and deployment results. Future workflow changes should use the [change-specific validation procedure](agent-guidance-validation.md#choose-checks-by-change-type).
