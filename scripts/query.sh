#!/usr/bin/env bash
# Ad-hoc questions.
#   scripts/query.sh ae "<SQL>"   Analytics Engine SQL API (about 90 days of raw events)
#   scripts/query.sh d1 "<SQL>"   D1 rollups (unlimited history), via the D1 API
# ae needs CF_ACCOUNT_ID and CF_API_TOKEN (Account Analytics Read) in the environment.
# d1 needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (D1 Read, or D1 Edit for writes), and jq.
# Always use SUM(_sample_interval * double1), never count().
set -euo pipefail

target="${1:-}"
sql="${2:-}"
if [[ -z "$target" || -z "$sql" ]]; then
  echo "usage: $0 ae|d1 \"<SQL>\"" >&2
  exit 2
fi

case "$target" in
  ae)
    : "${CF_ACCOUNT_ID:?set CF_ACCOUNT_ID}"
    : "${CF_API_TOKEN:?set CF_API_TOKEN}"
    curl --silent --show-error --fail \
      "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/analytics_engine/sql" \
      --header "Authorization: Bearer ${CF_API_TOKEN}" \
      --data "$sql"
    ;;
  d1)
    : "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
    : "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
    # Same lookup as export-public.sh: the wrangler config carries a placeholder database id
    # (deploy.sh substitutes the real one), so find the database by name. Failures print the API reply.
    base="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database"
    api() {
      local reply
      reply="$(curl --silent --show-error --fail-with-body \
        --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" "$@")" || {
        echo "error: Cloudflare API request failed: $reply" >&2
        return 1
      }
      printf '%s' "$reply"
    }
    db_id="$(api "${base}?name=gqlmd-telemetry" | jq -er '.result[] | select(.name == "gqlmd-telemetry") | .uuid')"
    # Prints the same [{results: [...], meta: {...}}] shape as `wrangler d1 execute --json`.
    api --header 'Content-Type: application/json' \
      --data "$(jq -nc --arg sql "$sql" '{sql: $sql}')" "${base}/${db_id}/query" | jq -e '.result'
    ;;
  *)
    echo "unknown target: $target" >&2
    exit 2
    ;;
esac
