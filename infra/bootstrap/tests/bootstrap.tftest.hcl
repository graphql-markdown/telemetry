mock_provider "cloudflare" {}

variables {
  account_id           = "00000000000000000000000000000000"
  cloudflare_api_token = "dummy"
}

run "state_bucket_name" {
  command = plan

  assert {
    condition     = cloudflare_r2_bucket.tfstate.name == "gqlmd-telemetry-tfstate"
    error_message = "state bucket must be gqlmd-telemetry-tfstate"
  }
}
