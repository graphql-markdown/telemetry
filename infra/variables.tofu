variable "account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "zone_id" {
  description = "ID of the Cloudflare zone for graphql-markdown.dev."
  type        = string
}

variable "domain" {
  description = "Public hostname of the telemetry Worker."
  type        = string
  default     = "telemetry.graphql-markdown.dev"
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token used by the provider."
  type        = string
  sensitive   = true
}

variable "state_passphrase" {
  description = "Passphrase for state and plan encryption."
  type        = string
  sensitive   = true
}

variable "alert_webhook" {
  description = "Discord/Slack-compatible webhook for the no-events alert. Empty disables it."
  type        = string
  sensitive   = true
  default     = ""
}

variable "dashboard_emails" {
  description = "Email addresses allowed to open the dashboard (one-time PIN login)."
  type        = list(string)
}

variable "access_team_domain" {
  description = "Zero Trust team domain, e.g. myteam.cloudflareaccess.com (JWKS host and JWT issuer)."
  type        = string
}

variable "public_stats" {
  description = "\"true\" enables the public aggregates at /public. Default off."
  type        = string
  default     = "false"
}
