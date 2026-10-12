# Cloudflare Access (Zero Trust) in front of the whole dashboard Worker URL
# (dashboard and stats API). The ingest Worker is a separate workers.dev URL and
# stays public. The dashboard Worker also verifies the Access JWT itself
# (ACCESS_TEAM_DOMAIN / ACCESS_AUD).
# Prerequisite: Zero Trust is enabled on the account and its team domain set
# (Zero Trust > Settings > Custom Pages). Attribute names follow the
# cloudflare/cloudflare v5 provider; the uncertain ones are marked `# verify`.

# One-time PIN login: an emailed code, no external identity provider needed.
resource "cloudflare_zero_trust_access_identity_provider" "otp" {
  account_id = var.account_id
  name       = "One-time PIN"
  type       = "onetimepin"
  config     = {} # verify: v5 may require an explicit empty object
}

resource "cloudflare_zero_trust_access_policy" "dashboard" {
  account_id = var.account_id
  name       = "${local.worker_name}-dashboard"
  decision   = "allow"

  include = [
    for email in var.dashboard_emails : {
      email = { email = email }
    }
  ] # verify: v5 include rule object shape
}

resource "cloudflare_zero_trust_access_application" "dashboard" {
  account_id       = var.account_id
  name             = "${local.worker_name}-dashboard"
  type             = "self_hosted"
  session_duration = "24h"
  allowed_idps     = [cloudflare_zero_trust_access_identity_provider.otp.id]

  # The whole dashboard host, no paths.
  destinations = [
    { type = "public", uri = local.dashboard_host },
  ] # verify: `destinations` (v5) replaces the older `domain` attribute, and accepts a workers.dev host
  # verify: if the provider rejects a workers.dev destination, enable Access on the Worker
  # by hand (see README) and pass its AUD tag in as access_aud_override.

  policies = [
    { id = cloudflare_zero_trust_access_policy.dashboard.id, precedence = 1 },
  ] # verify: v5 policy reference shape
}
