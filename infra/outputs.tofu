output "domain" {
  description = "Public hostname of the telemetry Worker."
  value       = var.domain
}

output "access_aud" {
  description = "AUD tag of the Access application (the Worker's ACCESS_AUD)."
  value       = cloudflare_zero_trust_access_application.dashboard.aud
}

output "access_team_domain" {
  description = "Zero Trust team domain used by the Worker to fetch the Access JWKS."
  value       = var.access_team_domain
}

output "d1_database_id" {
  description = "ID of the D1 database (substituted into wrangler.jsonc by scripts/deploy.sh)."
  value       = cloudflare_d1_database.telemetry.id
}
