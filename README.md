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

## Testing infrastructure

Plan-only OpenTofu tests use mocked providers, so no credentials are needed. The Worker bundle is replaced by `infra/tests/fixtures/worker.js` through `worker_bundle_path`, so no build is required.

```sh
cd infra && tofu init -backend=false && tofu test
cd infra/bootstrap && tofu init -backend=false && tofu test
```

## Setup

Follow these steps in order. Every command runs from the repository root unless a `cd` is shown.

### 1. Prerequisites

- A Cloudflare account, with the zone `graphql-markdown.dev` on it and Zero Trust enabled (Zero Trust > Settings: set the team domain, for example `myteam.cloudflareaccess.com`).
- [OpenTofu](https://opentofu.org) matching `.opentofu-version` (`1.10.x`).
- [bun](https://bun.sh). Install the dependencies, including the pinned `wrangler`, with `bun install`.

### 2. Cloudflare API token

Create a token at Cloudflare dashboard > My Profile > API Tokens, with these permissions:

| Scope | Permission |
| --- | --- |
| Account | Workers Scripts: Edit |
| Account | D1: Edit |
| Account | Workers R2 Storage: Edit |
| Account | Access: Apps and Policies: Edit |
| Account | Account Analytics: Read |
| Account | API Tokens: Edit (tofu creates the read-only Analytics token used by the cron) |
| Zone (graphql-markdown.dev) | Workers Routes: Edit |
| Zone (graphql-markdown.dev) | DNS: Edit (custom domains create the DNS record) |

Note the **account ID** (dashboard home > account menu > Copy account ID) and the **zone ID** (zone Overview page, right column).

### 3. One-time bootstrap

Create the R2 bucket `gqlmd-telemetry-tfstate` that holds the remote state:

```sh
cd infra/bootstrap
export TF_VAR_account_id=<account id>
export TF_VAR_cloudflare_api_token=<token>
tofu init
tofu apply
```

Then in the dashboard go to R2 > Manage API tokens and create an S3 credential with Object Read & Write on that bucket. Keep the access key ID and secret. See `infra/bootstrap/README.md` for details.

### 4. GitHub secrets and variables

Add these under Settings > Secrets and variables > Actions. The names match the tofu variables (`TF_VAR_<name>`) and the commented-out apply step in `.github/workflows/ci.yml`:

| Name | Kind | Used for |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | secret | `account_id` and wrangler |
| `CLOUDFLARE_API_TOKEN` | secret | `cloudflare_api_token` and wrangler |
| `AWS_ACCESS_KEY_ID` | secret | R2 S3 access key for the state backend |
| `AWS_SECRET_ACCESS_KEY` | secret | R2 S3 secret for the state backend |
| `TOFU_STATE_PASSPHRASE` | secret | `state_passphrase`; keep a copy in a password manager, losing it makes the state unreadable |
| `ALERT_WEBHOOK` | secret, optional | `alert_webhook` (no-events alert) |
| `ZONE_ID` | variable | `zone_id` |
| `ACCESS_TEAM_DOMAIN` | variable | `access_team_domain` |
| `DASHBOARD_EMAILS` | variable | `dashboard_emails`, a JSON list such as `["you@example.com"]` |

The workflow does not apply infrastructure yet, so these are only read by a future apply job. For manual runs, export the same values as `TF_VAR_account_id`, `TF_VAR_zone_id`, `TF_VAR_cloudflare_api_token`, `TF_VAR_state_passphrase`, `TF_VAR_access_team_domain` and `TF_VAR_dashboard_emails` (and optionally `TF_VAR_alert_webhook`, `TF_VAR_public_stats`).

### 5. Initialise and apply the infrastructure

The Worker bundle must exist first, because `infra/worker.tofu` reads it:

```sh
bun run build
cd infra
export AWS_ACCESS_KEY_ID=<R2 access key>
export AWS_SECRET_ACCESS_KEY=<R2 secret>
tofu init -backend-config="endpoints={s3=\"https://<account id>.r2.cloudflarestorage.com\"}"
tofu apply
```

This creates the D1 database, the Worker with its secrets and vars (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `PUBLIC_STATS`), the custom domain and the Access application. `PUBLIC_STATS` is owned by tofu (`public_stats`, default `"false"`); `keep_vars` stops `wrangler deploy` from resetting it.

### 6. Deploy the Worker and migrations

```sh
export CLOUDFLARE_API_TOKEN=<token>
export CLOUDFLARE_ACCOUNT_ID=<account id>
scripts/deploy.sh
```

The script reads `d1_database_id` from the tofu output, writes a temporary copy of `worker/wrangler.jsonc` with the real id, runs `wrangler deploy` and `wrangler d1 migrations apply gqlmd-telemetry --remote`, then deletes the copy. It needs `tofu` initialised in `infra/`. Run it again after each Worker change or new file in `migrations/`.

### 7. Verify

```sh
# Expect HTTP 202
curl -i -X POST https://telemetry.graphql-markdown.dev/v1/event \
  -H 'Content-Type: application/json' \
  -d '{"v":1,"event":"config","pkg":"@graphql-markdown/cli","pkgVersion":"1.2.3","nodeMajor":24,"graphqlMajor":16,"os":"darwin","ci":false,"pm":"npm","firstRun":false,"trigger":"cli","container":false,"wsl":false,"loader":"url","config":{"schema":"<url>","formatter":"@graphql-markdown/docusaurus"}}'

# Expect HTTP 403 (no Access JWT)
curl -i 'https://telemetry.graphql-markdown.dev/v1/stats?dim=os'
```

Then open https://telemetry.graphql-markdown.dev/ in a browser and log in with a one-time PIN sent to an address in `dashboard_emails`. The test event appears after the daily rollup (02:00 UTC) of the following day.

### 8. Enable the client

In the monorepo, set `DEFAULT_ENDPOINT` in `packages/telemetry/src/constants.ts` to `https://telemetry.graphql-markdown.dev/v1/event`. It is empty until the Worker is live, which keeps telemetry disabled. Release `@graphql-markdown/telemetry` afterwards.

### 9. Local development

```sh
cp worker/.dev.vars.example worker/.dev.vars   # gitignored
bun run dev        # wrangler dev
bun run typecheck
bun run test       # vitest
```

For the infrastructure, run `tofu fmt -check -recursive` and `tofu init -backend=false && tofu validate` in `infra/` (as CI does). Then run `tofu test` in `infra/` and `infra/bootstrap/` (see [Testing infrastructure](#testing-infrastructure)).

### 10. Token rotation and teardown

- **Rotate the API token:** create the new token with the scopes above, update `CLOUDFLARE_API_TOKEN` (GitHub and your shell), then revoke the old one. The Analytics read token used by the cron is managed by tofu: `tofu apply -replace=cloudflare_api_token.ae_sql` rotates it.
- **Rotate the R2 S3 credentials:** create new ones, update `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, then delete the old ones.
- **Do not rotate `TOFU_STATE_PASSPHRASE`** without migrating the state first; it encrypts the state and plans.
- **Teardown:** `tofu destroy` in `infra/`, then in `infra/bootstrap` (this removes the state bucket; empty it first). Deleting the D1 database deletes the rollup history.

### Required Worker secrets

`AE_SQL_TOKEN` (Account Analytics Read) and `ACCOUNT_ID` for the daily rollup, and optionally `ALERT_WEBHOOK`, are all set by `infra/worker.tofu`.
