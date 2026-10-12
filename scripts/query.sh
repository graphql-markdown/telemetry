#!/usr/bin/env bash
# Ad-hoc questions.
#   scripts/query.sh ae "<SQL>"   Analytics Engine SQL API (about 90 days of raw events)
#   scripts/query.sh d1 "<SQL>"   D1 rollups (unlimited history), via wrangler
# ae needs CF_ACCOUNT_ID and CF_API_TOKEN (Account Analytics Read) in the environment.
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
    "$(dirname "$0")/../node_modules/.bin/wrangler" d1 execute gqlmd-telemetry \
      --remote --config "$(dirname "$0")/../worker/wrangler.jsonc" --command "$sql"
    ;;
  *)
    echo "unknown target: $target" >&2
    exit 2
    ;;
esac
