# graphql-markdown telemetry

Infrastructure and Worker for GraphQL-Markdown's anonymous usage telemetry.

- What is collected and how to opt out: https://graphql-markdown.dev/docs/telemetry
- Client: [`@graphql-markdown/telemetry`](https://github.com/graphql-markdown/graphql-markdown/tree/main/packages/telemetry)

No personal data is collected or stored: there are no identifiers, and no IP addresses are read or stored.

## Architecture

```
 CLI (@graphql-markdown/telemetry)
   │  POST /v1/event  (JSON, allowlisted fields only)
   ▼
 Ingest Worker  gqlmd-telemetry.<sub>.workers.dev
   │  validate, fingerprint, rate-limit, quarantine flag (KV)
   ├──► Analytics Engine   gqlmd_events (raw, ~90 days)
   │                       gqlmd_rejects (reason counters, no payload)
   │
   │  daily cron 02:00 UTC: roll up day D-1 from Analytics Engine
   ▼
 D1  gqlmd-telemetry   daily_counts, config_catalog, config_catalog_daily, rejects_daily, generate_daily, generate_errors_daily (unlimited history)
   │
   ├──► GET /v1/stats (and /catalog, /rejects, /generate)   JSON, Access JWT verified by the Worker
   └──► GET /           static dashboard
        (both on the dashboard Worker, gqlmd-telemetry-dashboard.<sub>.workers.dev,
        whole URL behind Cloudflare Access)

 Public page: static site on GitHub Pages (telemetry.graphql-markdown.dev), rebuilt daily by
 .github/workflows/public-stats.yml from scripts/export-public.sh (no Worker route)
```

## Privacy invariants

These hold in every change. Review them before merging anything that touches `worker/`.

- The Worker never reads, logs, hashes or stores the IP address, the User-Agent, or any request header except `Content-Type`, `Content-Encoding` and `Content-Length`.
- The only other header read is the Access JWT, and only on `/v1/stats`. `request.cf.colo` is used in memory for rate limits and the quarantine key (KV, 1 h TTL), and is never stored.
- No `console.log` of request data. `observability.enabled` is `false` in `worker/wrangler.jsonc`.
- Only allowlisted payload fields are stored (`worker/src/schema.ts`). Reject counters carry the reason only.
- The dashboard and public pages send a strict Content-Security-Policy (`default-src 'self'`, no inline script or style, `frame-ancestors 'none'`) and `Referrer-Policy: no-referrer`. uPlot is self-hosted in `dashboard/vendor/`. The dashboard gets the headers from `dashboard/_headers`. GitHub Pages cannot set headers, so the public page carries the policy in a `<meta>` tag in `public/index.html` (no `frame-ancestors`, which meta ignores).

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
- There are three measures. **Events** are raw data points, an upper bound. **Debounced** counts (1 d windows, one per distinct config per day) are sums of daily values. **Distinct configs** (`fp_shape`) are a lower bound. The true number lies in between.
- Quarantined rows (`blob17 = '1'`) are kept in Analytics Engine but excluded from `raw` and from the public aggregates.
- The `n<5` rule applies after aggregation: any value with fewer than 5 events in the selected range is hidden and counted as suppressed. The rule is on the range total per value: the daily points of a value that is shown are published as they are (dashboard and public page), so small per-day counts can be visible.

## Generate event

`event: "generate"` (payload `v: 1`) carries the usual header fields and no `config`, `cli` or `loader` (rejected if present). Extra fields, all rejected (204, reason `schema`) on any other event:

- `durationMs`: required, integer multiple of 100, 0 to 86,400,000. Stored in double3.
- `pages`: required integer, 0 to 1,000,000. Stored in double2.
- `errorType`: optional, failures only, stored in blob20. One anchored allowlist pattern (`ALLOWLIST.errorTypePattern`): `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `GraphQLError`, `AggregateError`, `AbortError`, `SystemError` or `<custom-error>`, each with an optional `:E[A-Z]+` system code, or `<no-schema>`; any of them may be prefixed `post:`.

The rollup fills `generate_daily` (runs, failures, weighted p50/p95 of pages and duration per version, trigger and ci) and `generate_errors_daily`. `GET /v1/stats/generate` serves them with the `n<5` rule applied to runs over the range.

## Testing infrastructure

Plan-only OpenTofu tests use mocked providers, so no credentials are needed. The Worker bundle is replaced by `infra/tests/fixtures/worker.js` through `worker_bundle_path`, so no build is required.

```sh
cd infra && tofu init -backend=false && tofu test
cd infra/bootstrap && tofu init -backend=false && tofu test
```

## Public statistics page

The public page is a static site on GitHub Pages at https://telemetry.graphql-markdown.dev. No Worker serves it. It is a read-only copy of the dashboard panels (KPI tiles, time-series charts, share bars, data tables, light/dark theme) with no filters and a fixed last-90-days range. `.github/workflows/public-stats.yml` runs daily at 03:00 UTC (and on manual dispatch, on `main` only) and calls `scripts/build-public.sh`, which assembles the page from `public/`, shares `style.css`, the logo, favicon and `vendor/` assets with `dashboard/`, and exports suppressed aggregates (n < 5 hidden) from D1 into `stats.json` through `scripts/export-public.sh` and `scripts/public-stats.jq` (needs `jq`). In `stats.json`, `generated` is the full UTC timestamp (`YYYY-MM-DDTHH:MM:SSZ`) and the page shows only its date; `from` and `to` bound the 90-day range. The result is published to the `gh-pages` branch. It shows the All view (local + CI runs together), like the dashboard default; the CI-vs-local and CI-provider panels split them.

One-time steps:

1. Repository Settings > Pages: set the source to the `gh-pages` branch.
2. Set the custom domain to `telemetry.graphql-markdown.dev` and enable Enforce HTTPS.
3. Add the DNS record `CNAME telemetry -> graphql-markdown.github.io`.

The workflow needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets to read D1. It does not use the `production` environment, so no approval gate applies. Prefer a read-only D1 token (D1 Read only) over the deploy token.

## Setup

Follow these steps in order. Every command runs from the repository root unless a `cd` is shown.

### 1. Prerequisites

- A Cloudflare account with Zero Trust enabled (Zero Trust > Settings: set the team domain, for example `myteam.cloudflareaccess.com`) and a workers.dev subdomain set (Workers & Pages > Account details). R2 enabled once in the dashboard (R2 Object Storage > enable, accept the terms and add a payment method; usage here stays in the free tier). Without it the bootstrap fails with `403 … code 10042: Please enable R2 through the Cloudflare Dashboard`. Enable Analytics Engine once as well (Workers & Pages > Analytics Engine; free), otherwise the Worker upload fails with `403 … code 10089`. No zone is needed: both Workers are served on workers.dev.
- [OpenTofu](https://opentofu.org) matching `.opentofu-version` (`1.10.x`).
- [bun](https://bun.sh). Install the dependencies, including the pinned `wrangler`, with `bun install`.

### 2. Cloudflare API token

Create a token at Cloudflare dashboard > My Profile > API Tokens, with these permissions:

| Scope | Permission |
| --- | --- |
| Account | Workers Scripts: Edit |
| Account | D1: Edit |
| Account | Workers KV Storage: Edit |
| Account | Workers R2 Storage: Edit |
| Account | Access: Apps and Policies: Edit |
| Account | Access: Organizations, Identity Providers, and Groups: Edit (the One-time PIN login; without it: 403 `auth.forbidden`, code 1010) |
| Account | Account Analytics: Read |

There are no Zone permissions. Note the **account ID** (dashboard home > account menu > Copy account ID) and the **workers.dev subdomain** (the `<sub>` in `<script>.<sub>.workers.dev`).

The cron needs a second, read-only token for the Analytics Engine SQL API. Create it the same way with a single permission, **Account | Account Analytics: Read**, restricted to this account. Keep it for step 4 (`AE_SQL_TOKEN`).

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

Add these under Settings > Secrets and variables > Actions. The names match the tofu variables (`TF_VAR_<name>`) and the `deploy` job in `.github/workflows/ci.yml`. Put them at repository level or in the `production` environment the job uses:

| Name | Kind | Used for |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | secret | `account_id` and wrangler |
| `CLOUDFLARE_API_TOKEN` | secret | `cloudflare_api_token` and wrangler |
| `AWS_ACCESS_KEY_ID` | secret | R2 S3 access key for the state backend |
| `AWS_SECRET_ACCESS_KEY` | secret | R2 S3 secret for the state backend |
| `TOFU_STATE_PASSPHRASE` | secret | `state_passphrase`; keep a copy in a password manager, losing it makes the state unreadable |
| `AE_SQL_TOKEN` | secret | `ae_sql_token`, the read-only Analytics token from step 2 |
| `ALERT_WEBHOOK` | secret, optional | `alert_webhook` (no-events alert) |
| `WORKERS_SUBDOMAIN` | variable | `workers_subdomain`, the bare label such as `graphql-markdown` (not `graphql-markdown.workers.dev`) |
| `ACCESS_TEAM_DOMAIN` | variable | `access_team_domain` |
| `ACCESS_AUD` | variable | `access_aud`, the AUD tag of the Access application (step 5) |
| `DASHBOARD_EMAILS` | secret | `dashboard_emails`, a JSON list such as `["you@example.com"]`; a secret so the addresses stay out of the public logs |

Only the `deploy` job reads them. For manual runs, export the same values as `TF_VAR_account_id`, `TF_VAR_workers_subdomain`, `TF_VAR_cloudflare_api_token`, `TF_VAR_state_passphrase`, `TF_VAR_ae_sql_token`, `TF_VAR_access_team_domain`, `TF_VAR_access_aud` and `TF_VAR_dashboard_emails` (and optionally `TF_VAR_alert_webhook`).

### 5. Initialise and apply the infrastructure

The Worker bundle must exist first, because `infra/worker.tofu` reads it:

```sh
bun run build
cd infra
export AWS_ACCESS_KEY_ID=<R2 access key>
export AWS_SECRET_ACCESS_KEY=<R2 secret>
tofu init -backend-config="endpoints={s3=\"https://<account id>.r2.cloudflarestorage.com\"}"
tofu apply -var access_aud=pending
```

This creates the D1 database, the quarantine KV namespace, and the two Workers with their workers.dev URLs. The ingest Worker gets the secrets, the dashboard Worker gets `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. It also creates the One-time PIN identity provider and the `gqlmd-telemetry-dashboard` Access policy.

The Cloudflare API refuses an Access application on a workers.dev host (error 12130), so tofu does not create it and `access_aud` is required. The dashboard Worker must exist before its Access toggle does, hence two passes. With the placeholder `pending` the dashboard rejects every request until the real value is set:

1. Enable Access on the Worker: Workers & Pages > gqlmd-telemetry-dashboard > Settings > Domains & Routes > workers.dev > Enable Cloudflare Access.
2. In Zero Trust > Access > Applications open the application it created, set its login method to One-time PIN, attach the `gqlmd-telemetry-dashboard` policy and remove the default policy. (`tofu output access_policy_id` and `tofu output otp_idp_id` print the ids.)
3. Copy the AUD tag (Application > Overview / Additional settings).
4. Apply again with the real value:

```sh
export TF_VAR_access_aud=<AUD tag>
tofu apply
```

### 6. Deploy the Workers and migrations

```sh
export CLOUDFLARE_API_TOKEN=<token>
export CLOUDFLARE_ACCOUNT_ID=<account id>
scripts/deploy.sh
```

The script reads `d1_database_id` and `quarantine_kv_id` from the tofu output, writes a temporary copy of `worker/wrangler.jsonc` with the real D1 and KV ids (and the same for `worker/wrangler.dashboard.jsonc`), runs `wrangler deploy` for both configs and `wrangler d1 migrations apply gqlmd-telemetry --remote` once, then deletes the copies. It needs `tofu` initialised in `infra/`. Run it again after each Worker change or new file in `migrations/`, or let CI do it (below).

### Deploy from CI

The `deploy` job in `.github/workflows/ci.yml` runs steps 5 and 6 (`tofu plan`, `tofu apply` of that saved plan, then `scripts/deploy.sh`) with the secrets and variables from step 4. It never runs on its own: open Actions > CI > Run workflow on `main`. It waits for the typecheck, test and OpenTofu jobs, and writes the plan to the run summary. The apply does not pause for review; to require an approval before the job starts, add required reviewers to the `production` environment (Settings > Environments). The first setup (two applies around the Access toggle) is still done by hand.

### 7. Verify

```sh
# Expect HTTP 202
curl -i -X POST https://gqlmd-telemetry.<sub>.workers.dev/v1/event \
  -H 'Content-Type: application/json' \
  -d '{"v":1,"event":"config","pkg":"@graphql-markdown/cli","pkgVersion":"1.2.3","nodeMajor":24,"graphqlMajor":16,"os":"darwin","ci":false,"pm":"npm","firstRun":false,"trigger":"cli","container":false,"wsl":false,"loader":"url","config":{"schema":"<url>","formatter":"@graphql-markdown/docusaurus"}}'

# Expect HTTP 404 (stats are served by the dashboard Worker only)
curl -i 'https://gqlmd-telemetry.<sub>.workers.dev/v1/stats?dim=os'

# Expect a redirect to the Access login (the whole dashboard URL is protected)
curl -i 'https://gqlmd-telemetry-dashboard.<sub>.workers.dev/v1/stats?dim=os'
```

Then open https://gqlmd-telemetry-dashboard.<sub>.workers.dev/ in a browser and log in with a one-time PIN sent to an address in `dashboard_emails`. The test event appears after the daily rollup (02:00 UTC) of the following day.

### 8. Enable the client

In the monorepo, set `DEFAULT_ENDPOINT` in `packages/telemetry/src/constants.ts` to `https://gqlmd-telemetry.<sub>.workers.dev/v1/event` (the `ingest_url` output plus `/v1/event`). It is empty until the Worker is live, which keeps telemetry disabled. Release `@graphql-markdown/telemetry` afterwards.

The URL is baked into released clients. Renaming the account's workers.dev subdomain or the `gqlmd-telemetry` script would break them, so do neither. If that ever happens, the escape hatches are the 410 kill switch (`RETIRED_VERSIONS`) and the client's endpoint env override.

### 9. Local development

```sh
cp worker/.dev.vars.example worker/.dev.vars   # gitignored
bun run dev        # wrangler dev
bun run typecheck
bun run test       # vitest
```

For the infrastructure, run `tofu fmt -check -recursive` and `tofu init -backend=false && tofu validate` in `infra/` (as CI does). Then run `tofu test` in `infra/` and `infra/bootstrap/` (see [Testing infrastructure](#testing-infrastructure)).

### 10. Token rotation and teardown

- **Rotate the API token:** create the new token with the scopes above, update `CLOUDFLARE_API_TOKEN` (GitHub and your shell), then revoke the old one. **Rotate the Analytics read token** (`AE_SQL_TOKEN`): create the new token, update the secret (and `TF_VAR_ae_sql_token` in your shell), run `tofu apply`, then revoke the old one.
- **Rotate the R2 S3 credentials:** create new ones, update `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, then delete the old ones.
- **Do not rotate `TOFU_STATE_PASSPHRASE`** without migrating the state first; it encrypts the state and plans.
- **Teardown:** `tofu destroy` in `infra/`, then in `infra/bootstrap` (this removes the state bucket; empty it first). Deleting the D1 database deletes the rollup history.

### Required Worker secrets

`AE_SQL_TOKEN` (Account Analytics Read, passed in as `ae_sql_token`) and `ACCOUNT_ID` for the daily rollup, and optionally `ALERT_WEBHOOK`, are all set by `infra/worker.tofu` on the ingest Worker.
