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
