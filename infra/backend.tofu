terraform {
  required_version = ">= 1.10"

  # State lives in the R2 bucket created by `infra/bootstrap`. Pass the
  # account-specific endpoint at init time (partial configuration):
  #   tofu init -backend-config="endpoints={s3=\"https://<account id>.r2.cloudflarestorage.com\"}"
  # Credentials come from AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
  backend "s3" {
    bucket = "gqlmd-telemetry-tfstate"
    key    = "telemetry/terraform.tfstate"
    region = "auto"

    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
    use_path_style              = true
  }

  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_passphrase
    }

    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }

    state {
      method   = method.aes_gcm.state
      enforced = true
    }

    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}
