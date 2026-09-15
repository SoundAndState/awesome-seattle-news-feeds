# Follow-up feed review

Reviewed the supplied HTML audit and two research notes against the existing catalog, then fetched proposed and unresolved feed addresses. The catalog grew from **70 to 96 feeds**: **21 new publications and five restored subscriptions**. The original 110 imports remain accounted for in the [import review](import-review.md).

The supplied research distinguished publisher discovery from feed validation. Its recommendations were used as leads, with current feed responses and article samples determining inclusion. Successful repairs already in the catalog were preserved.

## New publications

| Coverage | Added publications |
| --- | --- |
| Regional reporting and business | GeekWire, KUOW Local Stories, KNKX News, Seattle Daily Journal of Commerce |
| Neighborhoods and communities | Shoreline Area News, Westside Seattle, The Waterland Blog |
| Wider Washington and Northwest | InvestigateWest, RANGE Media, Salish Current, The Washington Observer |
| Official information | Public Health Insider |
| Commentary, analysis, and participant accounts | Sightline Institute, Cascadia Journal, Rondezvous, Puget Sound Anarchists, Hacks and Wonks, The Harbor Rat Report, Seattle Solidarity Network, Seattle Schools Community Forum, The STAND |

The catalog descriptions identify advocacy, author or organizational roles, first-person accounts, audio-first formats, and broader geographic coverage. A feed may contain summaries or subscriber previews rather than complete articles.

## Repairs and restorations

- **KUOW:** Its publisher-linked [Local Stories feed](https://www.kuow.org/tags/local-stories.rss) returned ten current articles. The homepage's `index.rss` returned no entries.
- **KNKX:** Used the publisher-linked [News feed](https://www.knkx.org/news.rss), which returned twelve entries. The proposed `index.rss` was empty. The news feed still includes some national stories.
- **Daily Journal of Commerce:** Found the [RSS address linked from the publisher's homepage](https://www.djc.com/cust/rss/rss2.php); it returned fifteen current entries.
- **Urban Living:** Restored the working current-domain feed at `https://cms.urbnlivn.com/feed/`. Labeled its brokerage perspective.
- **Visit Seattle:** Restored `https://visitseattle.org/feed/`, replacing the failing legacy blog host. Labeled its tourism-promotion role.
- **Seattle Times:** Restored Food and Drink, Real Estate, and Opinion as distinct, optional topic subscriptions. They are not exact duplicates of the civic feeds, but include nonlocal material. Local Politics remains the recommended narrower choice.
- **Seattle Streets Alliance:** Selected the [RSS address linked from its blog](https://www.streetsalliance.org/get-involved/blog/feed/). The root and blog feed addresses supplied the same article URLs; only one subscription is retained.

## Decisions needing context

**Seattle Bubble is publishing again.** Its [website](https://seattlebubble.com/blog/) shows July and August 2026 posts. The previous inactivity assessment described the stale FeedBurner copy, not the publication. The direct, publisher-linked `/blog/feed/` address returned HTTP 403 with the audit headers and a WordPress critical-error response with HTTP 500 using ordinary browser headers. The import record now identifies a feed-repair issue. It remains outside the active OPML until a populated current feed can be retrieved.

**Salish Current is included with a documented access limitation.** The publisher-linked feed returned sixteen current entries with ordinary browser headers, including Whatcom, Skagit, and San Juan reporting. The named automated checker received HTTP 403. This difference remains visible in the health results rather than being treated as a closure or silently marked successful.

**The Harbor Rat Report feed is populated but not strictly local.** Its entries are not in date order; the newest inspected item was dated September 6, 2026, despite an older first item. The project feed carries Grays Harbor material alongside national and international organizing coverage, interviews, and podcasts. Its catalog description reflects that mix.

**South Seattle Emerald remains active, but its current `stories.rss` returned zero entries.** Other unresolved sources still had access errors, invalid responses, unavailable hosts, or unresolved editorial relevance. They remain outside the active download with their reasons preserved; an unsuccessful fetch is not evidence of permanent closure.

The dormant and archive exclusions remain. Seattle City Council Insight's record now distinguishes the end of regular coverage from later one-off posts; the Seattle Globalist record cites the publisher's stated closure. Magnolia Voice is described as an editorial-relevance concern, without asserting that it was hacked or sold. The previously observed unrelated commercial redirect for U District Daily also remains a reason for exclusion.

## Verification

README linting, catalog validation, generated-file consistency, OPML validation, and all eleven existing tests passed locally. The full live check returned **95 successes, one access failure (Salish Current), and no identical article-set duplicate pairs**. The separate browser-header check verified Salish Current's populated feed. [Dated response evidence](follow-up-feed-review-2026-09-15.json) preserves both results.

Identical subscription detection does not remove individual syndicated or cross-listed articles. Intentional beat feeds and separate local editions can overlap.
