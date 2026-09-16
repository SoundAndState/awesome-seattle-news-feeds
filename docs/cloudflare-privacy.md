# Minimize Cloudflare logging

Sound & State disables optional feed-service logs and tracing. This does not make Cloudflare a service that retains no visitor information. Cloudflare receives network and request information, and its platform metrics remain separate from Worker logs. GitHub hosts the reader and has its own policies.

## Settings maintained in this repository

[`config/wrangler.jsonc`](../config/wrangler.jsonc) explicitly disables:

- Worker observability, invocation logs, log persistence, and log sampling.
- Tracing, trace persistence, and trace sampling.
- Logpush, log and trace export destinations, Tail Workers, and streaming Tail Workers.
- Wrangler usage telemetry (`send_metrics`). This controls the developer tool; it does not disable Cloudflare's traffic metrics.

Query-string redaction is also enabled as a precaution if someone later turns logging on. It does not hide the requested feed path, headers, or IP address and does not replace disabling logs.

[`proxy/worker.mjs`](../proxy/worker.mjs) does not emit console logs. It constructs publisher requests with a fixed Accept header and service User-Agent, rather than copying visitor headers. Cloudflare can add its own headers to outgoing requests; do not describe this as a guarantee that publishers never receive visitor information. See [Cloudflare's HTTP header behavior](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

The browser omits cookies, credentials, and referrers from feed requests. It keeps saved items, which items have been read, and preferences locally. If the feed service fails, the browser may contact the publisher directly. That publisher can then receive the visitor's IP address and request details.

The rate limiter still uses `CF-Connecting-IP` to enforce 240 requests per 60 seconds at each Cloudflare location. It does not write an application access log. Its counting period is not a promise that Cloudflare erases the IP address within 60 seconds. Removing this protection would expose the service to more abuse; hashing an IP without a secret would not make it anonymous. See the [rate-limiting documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Feed caches and `FEED_SNAPSHOTS` contain publisher content, not reading histories. Preserve the existing freshness limits and publisher cache restrictions.

## Check the deployed service

Use Node.js 24 or newer. Before deploying changes, run:

```sh
npm test
npm run check:proxy
```

Deploy with `npm run deploy:proxy`. It reads credentials from the environment or ignored `.env`. Never paste tokens into commands, documentation, or issue reports. Dashboard-only changes can drift from the next deployment, so keep this configuration authoritative.

In Cloudflare, open **Workers & Pages → awesome-seattle-feed-proxy → Settings** and check the observability settings after deployment. Keep Workers Logs, invocation logs, and traces off. Check that no Tail Workers or external log destinations are attached. For API verification, read [Get Script Settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/) and inspect `observability`, `logpush`, and `tail_consumers`; do not retrieve visitor logs to test whether logging is off.

Avoid opening a production live-log session or running `wrangler tail`. Live logging is a separate way to capture requests, console output, and errors even when stored Workers Logs are off. Use local fixtures to investigate failures. See [real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/).

## Check account and domain settings separately

The Worker configuration cannot control every Cloudflare product. Check only Sound & State's resources when the account hosts other projects.

1. **Logpush:** disable jobs that export Sound & State traffic at both account and zone level. Worker-level `logpush: false` does not disable unrelated HTTP or security-event exports. Inspect any former destinations for copies already exported.
2. **Log Explorer:** disable ingestion for relevant account and zone datasets. Canceling a subscription alone does not stop ingestion during the current billing cycle. Cloudflare also provides dataset deletion when existing records must be removed; confirm the dataset belongs to this project before deleting it. See [Manage datasets](https://developers.cloudflare.com/log-explorer/manage-datasets/).
3. **Logpull:** for a Cloudflare-proxied domain, check its retention flag and set it to `false` if enabled. Cloudflare documents `GET` and `POST /zones/{zone_id}/logs/control/retention/flag`, with `{"flag":false}` for the update. This does not disable other logging products. Previously retained logs remain until their retention period expires. See [log retention controls](https://developers.cloudflare.com/logs/logpull/enabling-log-retention/).
4. **Web Analytics:** keep automatic beacon injection off and remove any beacon or analytics integration from the reader. Check the dashboard even though the source contains no analytics script. Cloudflare Web Analytics and built-in Worker metrics are different products.
5. **Other products:** if the domain uses Access, WAF event logging, Browser Insights, or other integrations, review their logging and export settings separately. Do not disable protective rules simply to hide their event display. Ask Cloudflare which security records can actually be suppressed for the plan.

An API response that denies access, or a zone list that returns no accessible zones, does not establish that these features are disabled. Complete those checks with an appropriately scoped account or in the dashboard.

## What these controls cannot promise

[Worker metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/) include usage and performance information and can be inspected for up to three months. The documented observability switches do not provide a way to turn those metrics off.

[Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/) describes processing end-user IP addresses and traffic information, as well as aggregated data. Disabling optional customer logs does not establish that Cloudflare retains no operational, security, billing, or legally required records. Account audit records also differ from visitor access logs.

Turning logging off does not prove that earlier records have been erased. Cloudflare currently documents Workers Logs retention of three days on Free and seven days on Paid; exported copies follow their destination's retention rules. See [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

If retaining no information about visitors is a strict requirement, obtain a written answer from Cloudflare covering this Workers service, default metrics, security records, existing data, and deletion. If its service cannot meet that requirement, the hosting architecture or provider must change. A DNS-only record would remove Cloudflare's HTTP proxy for that hostname but would not remove the browser's separate requests to the `workers.dev` feed service or GitHub's records.

## Audit on 2026-09-15

The configured deployment token could read the feed Worker's settings and account-level logging configuration. Before hardening, it reported Worker Logpush off, no Tail Workers, no explicit observability object, no account Logpush jobs, and no account Log Explorer datasets.

The explicit configuration above and the removal of the redirect warning were deployed as Worker version `2d9a8564-649b-4eb1-afe8-2a006571b6da`. Cloudflare also accepted a direct update disabling observability and Logpush and clearing Tail Workers. Its settings API returned `logpush: false`, `tail_consumers: null`, and `observability: null` afterward, rather than echoing the individual disabled observability fields. A live feed request returned HTTP 200 after deployment. No visitor logs were retrieved during this audit.

Public DNS pointed `soundandstate.com` directly at GitHub Pages through `registrar-servers.com` nameservers. The live page identified GitHub as its server and contained no Cloudflare Web Analytics beacon. The domain is not currently using Cloudflare's HTTP proxy, so its zone-level HTTP logging controls are conditional on a future hosting change.

The token could not read account Web Analytics settings (HTTP 403), and the domain query returned no accessible `soundandstate.com` zone. This audit does not establish whether the account contains an unused Web Analytics site or old exported logs. The dashboard checks above cover those remaining questions.
