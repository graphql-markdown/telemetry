#!/usr/bin/env bash
# Deploy the Worker and apply D1 migrations against the real database.
# wrangler.jsonc carries a placeholder database_id, so this writes a temporary copy
# with the id from `tofu output d1_database_id` and points wrangler at it.
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, and an initialised infra/ state.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
wrangler="$root/node_modules/.bin/wrangler"

db_id="$(tofu -chdir="$root/infra" output -raw d1_database_id)"
if [[ -z "$db_id" ]]; then
  echo "error: 'tofu output d1_database_id' is empty; run 'tofu apply' in infra/ first" >&2
  exit 1
fi

# Created next to wrangler.jsonc so its relative paths (main, assets, migrations) still resolve.
tmp="$(mktemp "$root/worker/wrangler.deploy.XXXXXX")"
trap 'rm -f "$tmp" "$tmp.jsonc"' EXIT
mv "$tmp" "$tmp.jsonc"
tmp="$tmp.jsonc"

sed "s/00000000-0000-0000-0000-000000000000/$db_id/" "$root/worker/wrangler.jsonc" > "$tmp"
if ! grep -q "$db_id" "$tmp"; then
  echo "error: placeholder database_id not found in worker/wrangler.jsonc" >&2
  exit 1
fi

"$wrangler" deploy --config "$tmp"
"$wrangler" d1 migrations apply gqlmd-telemetry --remote --config "$tmp"
