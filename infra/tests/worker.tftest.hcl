# Plan-only tests: mocked providers, no credentials. Run with `tofu test`.

mock_provider "cloudflare" {}

variables {
  account_id           = "00000000000000000000000000000000"
  zone_id              = "11111111111111111111111111111111"
  domain               = "telemetry.example.test"
  cloudflare_api_token = "dummy"
  ae_sql_token         = "dummy-read-token"
  state_passphrase     = "dummy-passphrase-0123456789"
  dashboard_emails     = ["me@example.test"]
  access_team_domain   = "team.cloudflareaccess.com"
  worker_bundle_path   = "tests/fixtures/worker.js"
}

run "worker_script" {
  command = plan

  assert {
    condition     = cloudflare_workers_script.telemetry.observability.enabled == false
    error_message = "observability must be disabled"
  }

  assert {
    condition = alltrue([
      for n in ["EVENTS", "REJECTS", "RL", "RL_HARD", "RL_COLO", "DB", "AE_SQL_TOKEN", "ALERT_WEBHOOK", "ACCESS_AUD", "ACCESS_TEAM_DOMAIN"] :
      contains([for b in cloudflare_workers_script.telemetry.bindings : b.name], n)
    ])
    error_message = "missing a required binding" # verify: bindings is a list of objects in v5
  }

  assert {
    condition     = [for b in cloudflare_workers_script.telemetry.bindings : b.dataset if b.name == "EVENTS"][0] == "gqlmd_events"
    error_message = "EVENTS must bind gqlmd_events"
  }

  assert {
    condition     = [for b in cloudflare_workers_script.telemetry.bindings : b.type if b.name == "AE_SQL_TOKEN"][0] == "secret_text"
    error_message = "AE_SQL_TOKEN must be secret_text"
  }

  assert {
    condition     = [for b in cloudflare_workers_script.telemetry.bindings : b.type if b.name == "ALERT_WEBHOOK"][0] == "secret_text"
    error_message = "ALERT_WEBHOOK must be secret_text"
  }

  assert {
    condition     = [for b in cloudflare_workers_script.telemetry.bindings : b.type if b.name == "DB"][0] == "d1"
    error_message = "DB must be a d1 binding"
  }

  assert {
    condition     = [for b in cloudflare_workers_script.telemetry.bindings : b.text if b.name == "PUBLIC_STATS"][0] == "false"
    error_message = "PUBLIC_STATS must default to \"false\""
  }
}

run "no_secret_as_plain_text" {
  command = plan

  assert {
    condition = alltrue([
      for b in cloudflare_workers_script.telemetry.bindings :
      b.type != "plain_text" || !contains(["AE_SQL_TOKEN", "ALERT_WEBHOOK", "ACCOUNT_ID"], b.name)
    ])
    error_message = "secrets must never be plain_text"
  }
}

run "custom_domain" {
  command = plan

  assert {
    condition     = cloudflare_workers_custom_domain.telemetry.hostname == var.domain
    error_message = "custom domain must equal var.domain"
  }
}

run "cron" {
  command = plan

  assert {
    condition     = cloudflare_workers_cron_trigger.rollup.schedules[0].cron == "0 2 * * *"
    error_message = "rollup cron must be 0 2 * * *"
  }
}

run "ae_sql_token_from_variable" {
  command = plan

  assert {
    condition     = [for b in cloudflare_workers_script.telemetry.bindings : b.type if b.name == "AE_SQL_TOKEN"][0] == "secret_text"
    error_message = "AE_SQL_TOKEN must be secret_text"
  }

  assert {
    condition     = [for b in cloudflare_workers_script.telemetry.bindings : b.text if b.name == "AE_SQL_TOKEN"][0] == var.ae_sql_token
    error_message = "AE_SQL_TOKEN must come from var.ae_sql_token"
  }
}

run "empty_ae_sql_token_rejected" {
  command = plan

  variables {
    ae_sql_token = ""
  }

  expect_failures = [var.ae_sql_token]
}

run "access_application" {
  command = plan

  assert {
    condition = alltrue([
      contains([for d in cloudflare_zero_trust_access_application.dashboard.destinations : d.uri], "${var.domain}/"),
      contains([for d in cloudflare_zero_trust_access_application.dashboard.destinations : d.uri], "${var.domain}/v1/stats*"),
    ])
    error_message = "Access must cover / and /v1/stats*" # verify: destinations shape
  }

  assert {
    condition = alltrue([
      for d in cloudflare_zero_trust_access_application.dashboard.destinations :
      !strcontains(d.uri, "/v1/event") && !strcontains(d.uri, "/public")
    ])
    error_message = "Access must not cover /v1/event or /public*"
  }

  assert {
    condition     = length(cloudflare_zero_trust_access_policy.dashboard.include) == length(var.dashboard_emails)
    error_message = "policy must include exactly var.dashboard_emails" # verify: include shape
  }
}

run "empty_dashboard_emails_rejected" {
  command = plan

  variables {
    dashboard_emails = []
  }

  expect_failures = [var.dashboard_emails]
}
