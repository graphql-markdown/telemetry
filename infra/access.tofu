# Cloudflare Access (Zero Trust) in front of the dashboard and the stats API.
# /v1/event and /public* are NOT covered: they stay public. The Worker also
# verifies the Access JWT itself (ACCESS_TEAM_DOMAIN / ACCESS_AUD).
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

  # Same hostname, two path scopes. /v1/event and /public* are left out.
  destinations = [
    { type = "public", uri = "${var.domain}/" },
    { type = "public", uri = "${var.domain}/v1/stats*" },
  ] # verify: `destinations` (v5) replaces the older `domain` attribute

  policies = [
    { id = cloudflare_zero_trust_access_policy.dashboard.id, precedence = 1 },
  ] # verify: v5 policy reference shape
}
