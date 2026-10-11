terraform {
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

variable "account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with R2 edit permission."
  type        = string
  sensitive   = true
}

resource "cloudflare_r2_bucket" "tfstate" {
  account_id = var.account_id
  name       = "gqlmd-telemetry-tfstate"
}

output "bucket" {
  value = cloudflare_r2_bucket.tfstate.name
}
