# The telemetry Worker. Build first (`bun run build`) so ../dist/index.js exists.

locals {
  worker_name = "gqlmd-telemetry"
}

resource "cloudflare_workers_script" "telemetry" {
  account_id  = var.account_id
  script_name = local.worker_name

  # Module worker bundled by `wrangler deploy --dry-run --outdir dist`.
  main_module        = "index.js"
  content            = file("${path.module}/../dist/index.js") # verify: v5 may prefer content_file + content_sha256
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
  ] # verify: binding attribute names (namespace_id, simple) against the v5 schema
}

resource "cloudflare_workers_custom_domain" "telemetry" {
  account_id  = var.account_id
  zone_id     = var.zone_id
  hostname    = var.domain
  service     = cloudflare_workers_script.telemetry.script_name
  environment = "production" # verify: attribute still required in v5
}

check "observability_disabled" {
  assert {
    condition     = cloudflare_workers_script.telemetry.observability.enabled == false
    error_message = "Worker observability must stay disabled: no request data may be logged."
  }
}
