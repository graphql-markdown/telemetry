# Plan-only tests: mocked providers, no credentials. Run with `tofu test`.

mock_provider "cloudflare" {}

variables {
  account_id           = "00000000000000000000000000000000"
  workers_subdomain    = "example"
  cloudflare_api_token = "dummy"
  ae_sql_token         = "dummy-read-token"
  state_passphrase     = "dummy-passphrase-0123456789"
  dashboard_emails     = ["me@example.test"]
  access_aud           = "dummy-aud"
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
      for n in ["EVENTS", "REJECTS", "RL", "RL_HARD", "RL_COLO", "DB", "AE_SQL_TOKEN", "ALERT_WEBHOOK", "ROLE"] :
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

run "workers_dev_subdomains" {
  command = plan

  assert {
    condition     = cloudflare_workers_script_subdomain.telemetry.script_name == "gqlmd-telemetry" && cloudflare_workers_script_subdomain.telemetry.enabled == true
    error_message = "the ingest Worker must be enabled on workers.dev" # verify: v5 attribute names
  }

  assert {
    condition     = cloudflare_workers_script_subdomain.dashboard.script_name == "gqlmd-telemetry-dashboard" && cloudflare_workers_script_subdomain.dashboard.enabled == true
    error_message = "the dashboard Worker must be enabled on workers.dev"
  }

  assert {
    condition     = cloudflare_workers_script_subdomain.telemetry.previews_enabled == false && cloudflare_workers_script_subdomain.dashboard.previews_enabled == false
    error_message = "preview URLs must stay off"
  }
}

run "worker_roles" {
  command = plan

  assert {
    condition     = [for b in cloudflare_workers_script.telemetry.bindings : b.text if b.name == "ROLE"][0] == "ingest"
    error_message = "the ingest Worker must have ROLE=ingest"
  }

  assert {
    condition     = [for b in cloudflare_workers_script.dashboard.bindings : b.text if b.name == "ROLE"][0] == "dashboard"
    error_message = "the dashboard Worker must have ROLE=dashboard"
  }

  assert {
    condition = alltrue([
      for b in cloudflare_workers_script.dashboard.bindings :
      !contains(["EVENTS", "REJECTS", "RL", "RL_HARD", "RL_COLO", "QUARANTINE", "AE_SQL_TOKEN", "ALERT_WEBHOOK", "ASSETS"], b.name)
    ])
    error_message = "the dashboard Worker must have no Analytics Engine, rate limit, KV or secret bindings"
  }

  assert {
    condition     = alltrue([for n in ["DB", "ROLE", "ACCESS_TEAM_DOMAIN", "ACCESS_AUD"] : contains([for b in cloudflare_workers_script.dashboard.bindings : b.name], n)])
    error_message = "the dashboard Worker needs DB, ROLE and the Access vars"
  }

  assert {
    condition     = cloudflare_workers_script.dashboard.observability.enabled == false
    error_message = "dashboard observability must be disabled"
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

run "access_policy_and_idp" {
  command = plan

  assert {
    condition     = length(cloudflare_zero_trust_access_policy.dashboard.include) == length(var.dashboard_emails)
    error_message = "policy must include exactly var.dashboard_emails" # verify: include shape
  }

  assert {
    condition     = cloudflare_zero_trust_access_identity_provider.otp.type == "onetimepin"
    error_message = "the identity provider must be one-time PIN"
  }
}

run "empty_access_aud_rejected" {
  command = plan

  variables {
    access_aud = ""
  }

  expect_failures = [var.access_aud]
}

run "empty_dashboard_emails_rejected" {
  command = plan

  variables {
    dashboard_emails = []
  }

  expect_failures = [var.dashboard_emails]
}

run "empty_workers_subdomain_rejected" {
  command = plan

  variables {
    workers_subdomain = ""
  }

  expect_failures = [var.workers_subdomain]
}

run "full_workers_subdomain_rejected" {
  command = plan

  variables {
    workers_subdomain = "graphql-markdown.workers.dev"
  }

  expect_failures = [var.workers_subdomain]
}

run "d1_read_replication_disabled" {
  command = plan

  assert {
    condition     = cloudflare_d1_database.telemetry.read_replication.mode == "disabled"
    error_message = "D1 read replication must be set explicitly to disabled"
  }
}
