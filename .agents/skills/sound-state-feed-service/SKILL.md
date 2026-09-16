---
name: sound-state-feed-service
description: "Change or review Sound & State feed proxy, caching, and snapshots; diagnose feed delivery failures. Use for service behavior, not routine feed selection or reader styling."
---

# Maintain feed delivery

Determine whether the task concerns publisher responses, Worker behavior, shared snapshots, or the browser's direct retry. Run commands from the repository root. For review or diagnosis, preserve that scope unless the user also requests a fix.

## Follow the failing path

- Use [proxy/worker.mjs](../../../proxy/worker.mjs) for origin checks, catalog ID routing, exact redirect destinations, bounded response reads, rate limits, and timeouts.
- Use [proxy/cache.mjs](../../../proxy/cache.mjs) for publisher cache directives and freshness; use [proxy/snapshots.mjs](../../../proxy/snapshots.mjs) for approved backup feeds, original collection times, and expiry.
- For collection failures, inspect [scripts/refresh-snapshots.mjs](../../../scripts/refresh-snapshots.mjs), [scripts/fetch-feed.py](../../../scripts/fetch-feed.py), and [the snapshot workflow](../../../.github/workflows/feed-snapshots.yml). For the subsequent browser retry, inspect [web/src/network.mjs](../../../web/src/network.mjs).

Record the tested feed ID, response or error, and where the request ran. A publisher can respond differently to a local browser, Cloudflare, and an Actions runner. Use `python scripts/check_feeds.py --only FEED_ID` for a targeted live check when needed, replacing `FEED_ID` with the catalog ID. Do not infer permanent unavailability from one network's refusal.

## Preserve the service boundary

- Keep catalog ID routing and verified exact HTTPS redirect destinations. Do not accept arbitrary target URLs, wildcard redirect permissions, embedded credentials, or forwarded browser cookies to repair one broken feed.
- Preserve the response-size limit, redirect-hop limit, and deadline across both fetch and body reading. Cancellation alone does not settle every upstream stream; test stalled bodies when changing timeout logic.
- Respect publisher cache restrictions and freshness calculations. Avoid caching errors and challenge pages. Do not assume a response that sets cookies is always cacheable or always uncacheable; consult `cache.mjs` and its tests.
- Use snapshots only for approved feeds, matching URLs, valid content, and permitted lifetimes. Preserve the original fetch time and stale indication. A snapshot-store failure must still allow the reader to receive the error and attempt its direct retry.
- If changing an externally visible failure or retry, update the relevant reader explanation. Use the reader skill for that affected UI work.

## Verify before publication

Run `npm test` and `npm run check:proxy` for service changes. Add focused behavior coverage in [tests/proxy.test.mjs](../../../tests/proxy.test.mjs), [tests/snapshots.test.mjs](../../../tests/snapshots.test.mjs), or [tests/network.test.mjs](../../../tests/network.test.mjs) for the changed contract. Run the root Python checks if changing Python tooling.

The dry run checks the Worker bundle; it does not demonstrate live Cloudflare behavior. `npm run deploy:proxy` and `node scripts/refresh-snapshots.mjs` write to Cloudflare and are not validation substitutes. Use them only when that external action is part of the authorized task; do not request approval again when the user already authorized it.

Report the observed failure, evidence for the fix or finding, preserved boundaries, checks run, and any unresolved live behavior.
