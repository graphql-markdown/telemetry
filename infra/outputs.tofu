output "ingest_url" {
  description = "Public URL of the ingest Worker."
  value       = "https://${local.ingest_host}"
}

output "dashboard_url" {
  description = "URL of the dashboard Worker (behind Access)."
  value       = "https://${local.dashboard_host}"
}

output "access_aud" {
  description = "AUD tag of the Access application (the Worker's ACCESS_AUD)."
  value       = var.access_aud
}

output "access_team_domain" {
  description = "Zero Trust team domain used by the Worker to fetch the Access JWKS."
  value       = var.access_team_domain
}

output "access_policy_id" {
  description = "ID of the reusable Access policy to attach by hand to the dashboard application."
  value       = cloudflare_zero_trust_access_policy.dashboard.id
}

output "otp_idp_id" {
  description = "ID of the One-time PIN identity provider to allow by hand on the dashboard application."
  value       = cloudflare_zero_trust_access_identity_provider.otp.id
}

output "d1_database_id" {
  description = "ID of the D1 database (substituted into wrangler.jsonc by scripts/deploy.sh)."
  value       = cloudflare_d1_database.telemetry.id
}

output "quarantine_kv_id" {
  description = "ID of the quarantine KV namespace (substituted into wrangler.jsonc by scripts/deploy.sh)."
  value       = cloudflare_workers_kv_namespace.quarantine.id
}
