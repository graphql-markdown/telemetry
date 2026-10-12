# The telemetry Worker. Build first (`bun run build`) so ../worker/dist/index.js exists.

locals {
  worker_name = "gqlmd-telemetry"
  bundle_path = coalesce(var.worker_bundle_path, "${path.module}/../worker/dist/index.js")
}

resource "cloudflare_d1_database" "telemetry" {
  account_id = var.account_id
  name       = local.worker_name
}

# Read-only token the cron uses for the Analytics Engine SQL API.
data "cloudflare_api_token_permission_groups_list" "analytics_read" {
  name      = "Account Analytics Read" # verify: exact permission group name in the v5 data source
  scope     = "com.cloudflare.api.account"
  max_items = 1
}

resource "cloudflare_api_token" "ae_sql" {
  name = "${local.worker_name}-ae-sql"

  policies = [
    {
      effect = "allow"
      permission_groups = [
        { id = data.cloudflare_api_token_permission_groups_list.analytics_read.result[0].id },
      ]
      # v5 takes resources as a JSON-encoded string.
      resources = jsonencode({
        "com.cloudflare.api.account.${var.account_id}" = "*"
      })
    },
  ]
}

resource "cloudflare_workers_script" "telemetry" {
  account_id  = var.account_id
  script_name = local.worker_name

  # Module worker bundled by `wrangler deploy --dry-run --outdir dist`.
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
      name = "AE_SQL_TOKEN"
      type = "secret_text"
      text = cloudflare_api_token.ae_sql.value
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
      name = "ACCESS_TEAM_DOMAIN"
      type = "plain_text"
      text = var.access_team_domain
    },
    {
      name = "ACCESS_AUD"
      type = "plain_text"
      text = cloudflare_zero_trust_access_application.dashboard.aud
    },
    {
      name = "PUBLIC_STATS"
      type = "plain_text"
      text = var.public_stats
    },
  ] # verify: binding attribute names (namespace_id, simple) against the v5 schema

  # wrangler deploy owns the bundle and the static assets after the first deploy;
  # tofu keeps the bindings and vars but must not overwrite the uploaded script.
  lifecycle {
    ignore_changes = [content]
  }
}

# Daily rollup of day D-1 (UTC).
resource "cloudflare_workers_cron_trigger" "rollup" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.telemetry.script_name
  schedules = [
    { cron = "0 2 * * *" },
  ]
}

resource "cloudflare_workers_custom_domain" "telemetry" {
  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = var.domain
  service    = cloudflare_workers_script.telemetry.script_name
}

check "observability_disabled" {
  assert {
    condition     = cloudflare_workers_script.telemetry.observability.enabled == false
    error_message = "Worker observability must stay disabled: no request data may be logged."
  }
}
