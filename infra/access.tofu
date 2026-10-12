# Cloudflare Access (Zero Trust) building blocks for the dashboard Worker.
# The Access application itself is NOT managed here: the API rejects workers.dev
# destinations (error 12130, "domain does not belong to zone"), so it is created by the
# workers.dev toggle on the Worker (see README) and the identity provider and policy
# below are attached to it by hand. The dashboard Worker verifies the Access JWT itself
# (ACCESS_TEAM_DOMAIN / ACCESS_AUD). The ingest Worker stays public.
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
