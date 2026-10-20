#!/usr/bin/env bash
# Export the public stats JSON (last 90 days, small counts suppressed).
#   scripts/export-public.sh [out.json]   default: stats.json
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
# Set D1_JSON_FILE to a saved wrangler output to skip the D1 call (offline testing).
set -euo pipefail

out="${1:-stats.json}"
here="$(dirname "$0")"

sql="SELECT dim, value, SUM(n) AS n FROM daily_counts WHERE dim IN ('formatter','graphqlMajor','loader.kind','pkgVersion') AND measure='raw' AND ci='0' AND day >= date('now','-89 days') AND day <= date('now') GROUP BY dim, value"

tmp="$(mktemp "${out}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

if [[ -n "${D1_JSON_FILE:-}" ]]; then
  raw="$(cat "$D1_JSON_FILE")"
else
  : "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
  : "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
  raw="$("$here/../node_modules/.bin/wrangler" d1 execute gqlmd-telemetry \
    --remote --json --config "$here/../worker/wrangler.jsonc" --command "$sql")"
fi

printf '%s' "$raw" | jq --argjson min 5 -f "$here/public-stats.jq" > "$tmp"
mv "$tmp" "$out"
