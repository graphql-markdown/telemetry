# The telemetry Workers, one bundle deployed twice on workers.dev (the account has no zone):
# the public ingest Worker and the dashboard Worker, whose whole URL sits behind Access.
# Build first (`bun run build`) so ../worker/dist/index.js exists.

locals {
  worker_name    = "gqlmd-telemetry"
  dashboard_name = "${local.worker_name}-dashboard"
  ingest_host    = "${local.worker_name}.${var.workers_subdomain}.workers.dev"
  dashboard_host = "${local.dashboard_name}.${var.workers_subdomain}.workers.dev"
  bundle_path    = coalesce(var.worker_bundle_path, "${path.module}/../worker/dist/index.js")
}

resource "cloudflare_d1_database" "telemetry" {
  account_id = var.account_id
  name       = local.worker_name

  # Provider v5 sends null otherwise and the API rejects it.
  read_replication = {
    mode = "disabled"
  }
}

# Quarantine flags (the Cache API does not work on workers.dev).
resource "cloudflare_workers_kv_namespace" "quarantine" {
  account_id = var.account_id
  title      = "${local.worker_name}-quarantine"
}

resource "cloudflare_workers_script" "telemetry" {
  account_id  = var.account_id
  script_name = local.worker_name

  # Module worker bundled by `wrangler deploy --dry-run --outdir dist`.
  main_module        = "index.js"
  content            = file(local.bundle_path) # verify: v5 may prefer content_file + content_sha256
  compatibility_date = "2026-08-01"

  # Observability (logs and traces) stays off: no request data is logged.
  observability = {
    enabled = false
  }

  bindings = [
    {
      name    = "EVENTS"
      type    = "analytics_engine"
      dataset = "gqlmd_events"
    },
    {
      name    = "REJECTS"
      type    = "analytics_engine"
      dataset = "gqlmd_rejects"
    },
    {
      # 100 events per 60 s per (fp, colo); tripping it starts a quarantine.
      name         = "RL"
      type         = "ratelimit"
      namespace_id = "1001"
      simple = {
        limit  = 100
        period = 60
      }
    },
    {
      # 2000 events per 60 s per colo, independent of the payload.
      name         = "RL_COLO"
      type         = "ratelimit"
      namespace_id = "1003"
      simple = {
        limit  = 2000
        period = 60
      }
    },
    {
      # Quota-protection ceiling: 1000 events per 60 s per (fp, colo).
      name         = "RL_HARD"
      type         = "ratelimit"
      namespace_id = "1002"
      simple = {
        limit  = 1000
        period = 60
      }
    },
    {
      name = "DB"
      type = "d1"
      id   = cloudflare_d1_database.telemetry.id
    },
    {
      name         = "QUARANTINE"
      type         = "kv_namespace"
      namespace_id = cloudflare_workers_kv_namespace.quarantine.id
    },
    {
      name = "AE_SQL_TOKEN"
      type = "secret_text"
      text = var.ae_sql_token
    },
    {
      name = "ACCOUNT_ID"
      type = "secret_text"
      text = var.account_id
    },
    {
      name = "ALERT_WEBHOOK"
      type = "secret_text"
      text = var.alert_webhook
    },
    {
      name = "ROLE"
      type = "plain_text"
      text = "ingest"
    },
  ] # verify: binding attribute names (namespace_id, simple) against the v5 schema

  # wrangler deploy owns the bundle after the first deploy; tofu keeps the
  # bindings and vars but must not overwrite the uploaded script.

  lifecycle {
    ignore_changes = [content]
  }
}

# Daily rollup of day D-1 (UTC), and the backfill tick that re-rolls one day
# queued in rollup_backfill (see worker/src/backfill.ts).
resource "cloudflare_workers_cron_trigger" "rollup" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.telemetry.script_name
  schedules = [
    { cron = "0 2 * * *" },
    { cron = "5,15,25,35,45,55 * * * *" },
  ]
}

# Dashboard Worker: same bundle, D1 only (no Analytics Engine, rate limit or KV), no cron.
resource "cloudflare_workers_script" "dashboard" {
  account_id  = var.account_id
  script_name = local.dashboard_name

  main_module        = "index.js"
  content            = file(local.bundle_path) # verify: v5 may prefer content_file + content_sha256
  compatibility_date = "2026-08-01"

  # verify: the dashboard/ static assets (ASSETS binding, run_worker_first) need a
  # v5 assets upload session, or deploy the Worker with `wrangler deploy` instead.

  # Observability (logs and traces) stays off: no request data is logged.
  observability = {
    enabled = false
  }

  bindings = [
    {
      name = "DB"
      type = "d1"
      id   = cloudflare_d1_database.telemetry.id
    },
    {
      name = "ROLE"
      type = "plain_text"
      text = "dashboard"
    },
    {
      name = "ACCESS_TEAM_DOMAIN"
      type = "plain_text"
      text = var.access_team_domain
    },
    {
      name = "ACCESS_AUD"
      type = "plain_text"
      text = var.access_aud
    },
    {
      # Uploaded by `wrangler deploy` (dashboard/); kept by keep_assets below.
      name = "ASSETS"
      type = "assets"
    },
  ] # verify: binding attribute names against the v5 schema

  # wrangler deploy owns the bundle and the static assets after the first deploy.
  # Without keep_assets and the ASSETS binding, each apply would drop the assets
  # until the next `wrangler deploy`.
  keep_assets = true

  lifecycle {
    ignore_changes = [content]
  }
}

# workers.dev URLs: <script>.<account subdomain>.workers.dev. Preview URLs stay off.
resource "cloudflare_workers_script_subdomain" "telemetry" {
  account_id       = var.account_id
  script_name      = cloudflare_workers_script.telemetry.script_name
  enabled          = true
  previews_enabled = false # verify: v5 attribute names (enabled, previews_enabled)
}

resource "cloudflare_workers_script_subdomain" "dashboard" {
  account_id       = var.account_id
  script_name      = cloudflare_workers_script.dashboard.script_name
  enabled          = true
  previews_enabled = false # verify: v5 attribute names (enabled, previews_enabled)
}

check "observability_disabled" {
  assert {
    condition = alltrue([
      cloudflare_workers_script.telemetry.observability.enabled == false,
      cloudflare_workers_script.dashboard.observability.enabled == false,
    ])
    error_message = "Worker observability must stay disabled: no request data may be logged."
  }
}
