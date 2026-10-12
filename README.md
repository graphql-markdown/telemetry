# graphql-markdown telemetry

Infrastructure and Worker for GraphQL-Markdown's anonymous usage telemetry.

- What is collected and how to opt out: https://graphql-markdown.dev/telemetry
- Client: [`@graphql-markdown/telemetry`](https://github.com/graphql-markdown/graphql-markdown/tree/main/packages/telemetry)
- Tracking issue: graphql-markdown/graphql-markdown#3447

No personal data is collected or stored: there are no identifiers, and no IP addresses are read or stored.

## Architecture

```
 CLI (@graphql-markdown/telemetry)
   │  POST /v1/event  (JSON, allowlisted fields only)
   ▼
 Worker  telemetry.graphql-markdown.dev
   │  validate, fingerprint, rate-limit, quarantine flag
   ├──► Analytics Engine   gqlmd_events (raw, ~90 days)
   │                       gqlmd_rejects (reason counters, no payload)
   │
   │  daily cron 02:00 UTC: roll up day D-1 from Analytics Engine
   ▼
 D1  gqlmd-telemetry   daily_counts, config_catalog, rejects_daily (unlimited history)
   │
   ├──► GET /v1/stats   JSON, Access JWT verified by the Worker
   └──► GET /           static dashboard, behind Cloudflare Access
        GET /public     optional aggregates, only when PUBLIC_STATS=true
```

## Privacy invariants

These hold in every change. Review them before merging anything that touches `worker/`.

- The Worker never reads, logs, hashes or stores the IP address, the User-Agent, or any request header except `Content-Type`, `Content-Encoding` and `Content-Length`.
- The only other header read is the Access JWT, and only on `/v1/stats`. `request.cf.colo` is used in memory for rate limits and the quarantine key, and is never stored.
- No `console.log` of request data. `observability.enabled` is `false` in `worker/wrangler.jsonc`.
- Only allowlisted payload fields are stored (`worker/src/schema.ts`). Reject counters carry the reason only.
- The dashboard and public pages send a strict Content-Security-Policy (`default-src 'self'`, no inline script or style, `frame-ancestors 'none'`) and `Referrer-Policy: no-referrer`. uPlot is self-hosted in `dashboard/vendor/`.

## Queries

Ad-hoc questions go through `scripts/query.sh`:

```sh
# Analytics Engine SQL API (about 90 days of raw events).
# Needs CF_ACCOUNT_ID and CF_API_TOKEN (Account Analytics Read).
scripts/query.sh ae "SELECT blob6 AS formatter, SUM(_sample_interval * double1) AS events FROM gqlmd_events WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY formatter"

# D1 rollups (unlimited history), through wrangler.
scripts/query.sh d1 "SELECT day, SUM(n) FROM daily_counts GROUP BY day ORDER BY day DESC LIMIT 7"
```

Notes:

- Always weight Analytics Engine rows with `SUM(_sample_interval * double1)`. Never use `count()`: sampled-out and flooded events carry a weight above 1.
- There are three measures. **Events** are raw data points, an upper bound. **Debounced** counts (1 h or 1 d windows, one per distinct config per window) are sums of daily values. **Distinct configs** (`fp_shape`) are a lower bound. The true number lies in between.
- Quarantined rows (`blob17 = '1'`) are kept in Analytics Engine but excluded from `raw` and from the public aggregates.
- The `n<5` rule applies after aggregation: any value with fewer than 5 events in the selected range is hidden and counted as suppressed. Do not publish per-row counts below that threshold.

## Deploy

1. **Bootstrap (once, by hand).** Create the R2 state bucket as described in `infra/bootstrap/README.md`. Store the R2 credentials and the state passphrase as GitHub secrets.
2. **Initialise the state backend.** The endpoint is account-specific, so pass it at init time:

   ```sh
   cd infra
   export AWS_ACCESS_KEY_ID=<R2 access key>
   export AWS_SECRET_ACCESS_KEY=<R2 secret>
   tofu init -backend-config="endpoints={s3=\"https://<account id>.r2.cloudflarestorage.com\"}"
   ```

3. **Apply the infrastructure first.** This creates the Worker, the D1 database, the Access application, the Worker secrets and the Access vars (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`):

   ```sh
   tofu apply
   ```

   `cloudflare_workers_script` has `lifecycle { ignore_changes = [content] }`, so later applies do not overwrite the bundle and assets uploaded by `wrangler deploy`. If you remove that block, run `tofu apply` with `-target` so it excludes the script content after the first deploy.

4. **Deploy the Worker** from `worker/` with `wrangler deploy`. It uploads the script and the static assets, and `keep_vars` preserves the tofu-set vars.

5. **Apply the D1 migrations.** Run this after the deploy, and again after each new file in `migrations/`:

   ```sh
   bunx wrangler d1 migrations apply gqlmd-telemetry --remote --config worker/wrangler.jsonc
   ```

   For local development, copy `worker/.dev.vars.example` to `worker/.dev.vars` (gitignored).

Required GitHub repository secrets:

| Secret | Used for |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID for the Worker, D1 and Analytics Engine |
| `CLOUDFLARE_API_TOKEN` | Token for `tofu apply` and `wrangler` (Workers, D1, Access, Analytics Engine) |
| `AWS_ACCESS_KEY_ID` | R2 state bucket access key |
| `AWS_SECRET_ACCESS_KEY` | R2 state bucket secret |
| `TOFU_STATE_PASSPHRASE` | Passphrase for the encrypted state (keep a copy in a password manager) |

Optional Worker secrets: `ALERT_WEBHOOK` (no-events alert). The Worker also needs `AE_SQL_TOKEN` (Account Analytics Read) and `ACCOUNT_ID` for the daily rollup; `infra/worker.tofu` sets them.
