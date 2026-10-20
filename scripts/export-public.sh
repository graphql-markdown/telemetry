#!/usr/bin/env bash
# Export the public stats JSON (last 90 days, small counts suppressed).
#   scripts/export-public.sh [out.json]   default: stats.json
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
# Queries D1 through the Cloudflare API. Set D1_JSON_FILE to a saved result to skip the call (offline testing).
set -euo pipefail

out="${1:-stats.json}"
here="$(dirname "$0")"

sql="SELECT day, ci, dim, measure, value, SUM(n) AS n FROM daily_counts WHERE day >= date('now','-89 days') AND day <= date('now') AND ((measure='raw' AND (dim IN ('pkgVersion','ci','ciProvider','formatter','graphqlMajor','loader.kind','event','target') OR dim IN ('setting.diffMethod','setting.force','setting.hierarchy','setting.mdxParser','setting.pretty','setting.telemetry'))) OR (measure='debounced_1d' AND dim='event')) GROUP BY day, ci, dim, measure, value"

tmp="$(mktemp "${out}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

if [[ -n "${D1_JSON_FILE:-}" ]]; then
  raw="$(cat "$D1_JSON_FILE")"
else
  : "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
  : "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
  # The wrangler config carries a placeholder database id (deploy.sh substitutes the real one),
  # so look the database up by name through the D1 API instead. Failures print the API reply.
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
  # .result is the same [{results: [...]}] shape that `wrangler d1 execute --json` prints.
  raw="$(api --header 'Content-Type: application/json' \
    --data "$(jq -nc --arg sql "$sql" '{sql: $sql}')" "${base}/${db_id}/query" | jq -ce '.result')"
fi

printf '%s' "$raw" | jq --argjson min 5 -f "$here/public-stats.jq" > "$tmp"
mv "$tmp" "$out"
