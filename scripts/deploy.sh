#!/usr/bin/env bash
# Deploy both Workers (ingest and dashboard) and apply D1 migrations against the real database.
# The wrangler configs carry placeholder ids, so this writes temporary copies
# with the ids from `tofu output` and points wrangler at them.
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, and an initialised infra/ state.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
wrangler="$root/node_modules/.bin/wrangler"

db_id="$(tofu -chdir="$root/infra" output -raw d1_database_id)"
if [[ -z "$db_id" ]]; then
  echo "error: 'tofu output d1_database_id' is empty; run 'tofu apply' in infra/ first" >&2
  exit 1
fi
kv_id="$(tofu -chdir="$root/infra" output -raw quarantine_kv_id)"
if [[ -z "$kv_id" ]]; then
  echo "error: 'tofu output quarantine_kv_id' is empty; run 'tofu apply' in infra/ first" >&2
  exit 1
fi

# Created next to the wrangler configs so their relative paths (main, assets, migrations) still resolve.
tmps=()
trap 'rm -f ${tmps[@]+"${tmps[@]}"}' EXIT

# Writes a copy of worker/$1 with the real ids and stores its path in the variable named $2.
render() {
  local tmp
  tmp="$(mktemp "$root/worker/wrangler.deploy.XXXXXX")"
  mv "$tmp" "$tmp.jsonc"
  tmp="$tmp.jsonc"
  tmps+=("$tmp")
  sed -e "s/00000000-0000-0000-0000-000000000000/$db_id/" \
    -e "s/00000000000000000000000000000001/$kv_id/" "$root/worker/$1" > "$tmp"
  if ! grep -q "$db_id" "$tmp"; then
    echo "error: placeholder database_id not found in worker/$1" >&2
    exit 1
  fi
  printf -v "$2" %s "$tmp"
}

render wrangler.jsonc ingest
render wrangler.dashboard.jsonc dashboard

"$wrangler" deploy --config "$ingest"
"$wrangler" deploy --config "$dashboard"
# Both Workers share one database: migrate once.
"$wrangler" d1 migrations apply gqlmd-telemetry --remote --config "$ingest"
