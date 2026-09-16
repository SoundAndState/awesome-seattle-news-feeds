# Reviewing publisher descriptions

## Purpose

Help readers understand what each source publishes, whom it serves, and which institution or person produces it. Use publishers' own language for relevant identities and roles, and apply the same editorial standards to community newsrooms, established media, advocates, businesses, and public agencies.

A description review can identify omissions, unsupported claims, and uneven framing. It cannot establish an author's subconscious intent or certify a publisher as unbiased. Self-description establishes how a publisher presents itself; it does not independently prove every claim the publisher makes.

## When to use this process

Use this process when adding a source, changing a description, responding to a publisher correction, or auditing the catalog. Review the affected publisher across all its channels for a single change. For a full audit, include every feed, category title and description, and auxiliary resource. Do not select only sources with racial, cultural, or political missions.

## Process

1. **Record the starting point.** Inspect local changes and preserve unrelated work. Read [AGENTS.md](../AGENTS.md) and the [contribution criteria](../.github/CONTRIBUTING.md). Record the catalog revision or checksum, review date, feed count, and exact existing descriptions from [data/feeds.json](../data/feeds.json). Use stable feed IDs to track coverage.
2. **Find the publisher's account.** Read its About page, mission, section description, or public account bio. Record the URL, access date, and a brief evidence summary. For social feeds, confirm the account using its stable identifier. When a page is inaccessible, try another publisher-controlled channel, such as its organizational profile or media kit; identify the channel and any dated evidence. A search excerpt alone may be incomplete. Do not silently substitute third-party characterizations.
3. **Check scope and genre.** Compare the description with the source's stated purpose and, where needed, recent feed items. Distinguish reporting, opinion, advocacy, satire, institutional announcements, and promotional content. Explain whether the evidence describes the organization, a section, or this specific feed. Avoid permanent claims about publication frequency based on a small sample.
4. **Check identities and agency.** Use the community names the publisher presents when they are relevant. Separate whom it serves from who owns, leads, or writes for it. Do not infer protected identities from a name, photograph, neighborhood, or topic. Do not turn people into only the subjects of poverty, crime, or institutional intervention. Retain supported roles such as member-run union or community-led newsroom, and recognize Tribes as the publisher names them.
5. **Compare like sources.** Ask whether a similar established daily, business group, public agency, or community newsroom would receive the same genre and interest disclosures. A stated cultural mission does not by itself justify an advocacy category. Government status does not establish neutrality. Check a publisher's website and social descriptions together; content scope can differ, but identity should not change accidentally.
6. **Write and classify the recommendation.** Use one concise sentence with concrete topics, source role, and relevant perspective. Prefer a faithful paraphrase over a promotional quotation. Omit unsupported superlatives and blanket trust claims. Classify each entry as Keep, Revise, Refine, or Verify, and explain the specific evidence and framing concern. Do not call every copy improvement discrimination.
7. **Check completeness and uncertainty.** Match reviewed IDs exactly to the catalog; check for omissions and duplicates. Review category placement and auxiliary resources separately. Resolve evidence gaps where possible and record any that remain. State the limits of feed samples and distinguish description review from feed-health verification or an assessment of which communities the catalog omits.
8. **Implement and verify.** Apply supported changes to `data/feeds.json`. Preserve feed IDs, URLs, aliases, category assignments, and `checkedOn` dates unless separate evidence supports changing them. Run `npm run ci` and, because descriptions appear in the reader, `npm run test:browser`. Check longer descriptions in desktop and phone source lists and expanded dialogs. Check documentation links and run `git diff --check`. Inspect generated README and OPML changes without hand-editing them; let the publication workflow commit those files after merge.

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

The changes restore Pacific Islander inclusion, follow publishers' preferred identity terms, recognize community and vendor agency, name Tribes among smoke-information partners, and make genre and institutional roles more consistent. They do not claim that the previous authors intended discrimination. This document and the shared AGENTS entry provide the reusable process; the dated audit preserves the source evidence and individual decisions.
