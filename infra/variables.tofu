variable "account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "workers_subdomain" {
  description = "The account's workers.dev subdomain (the <sub> in <script>.<sub>.workers.dev)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.workers_subdomain))
    error_message = "workers_subdomain is the bare <sub> label (e.g. \"graphql-markdown\"), without dots or \".workers.dev\"."
  }
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token used by the provider."
  type        = string
  sensitive   = true
}

variable "ae_sql_token" {
  description = "Read-only API token (Account Analytics: Read) the cron uses for the Analytics Engine SQL API. Created by hand, see README."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.ae_sql_token) > 0
    error_message = "ae_sql_token must not be empty."
  }
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
  # Kept out of plan output and CI logs (the repository is public).
  sensitive = true

  validation {
    condition     = length(var.dashboard_emails) > 0
    error_message = "dashboard_emails must contain at least one address."
  }
}

variable "access_team_domain" {
  description = "Zero Trust team domain, e.g. myteam.cloudflareaccess.com (JWKS host and JWT issuer)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+\\.cloudflareaccess\\.com$", var.access_team_domain))
    error_message = "access_team_domain is the full team host (e.g. \"myteam.cloudflareaccess.com\"), not the bare team name or a URL."
  }
}

variable "access_aud" {
  description = "AUD tag of the Access application created by the workers.dev toggle (see README). Any non-empty placeholder works for the first apply."
  type        = string

  validation {
    condition     = length(var.access_aud) > 0
    error_message = "access_aud must not be empty."
  }
}

variable "public_stats" {
  description = "\"true\" enables the public aggregates at /public. Default off."
  type        = string
  default     = "false"
}

variable "worker_bundle_path" {
  description = "Path to the bundled Worker. Null uses ../worker/dist/index.js (tests point it at a fixture)."
  type        = string
  default     = null
}
