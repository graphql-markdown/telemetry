#!/usr/bin/env bash
# One-off data migration: rewrite config_catalog.masked_config_json as canonical JSON
# (object keys sorted ascending at every level, array order kept), the format the
# Worker stores since the keys-sorted change. Safe to re-run: rows already sorted are skipped.
#   scripts/migrate-config-order.sh           dry run: print the planned rows (JSON lines), change nothing
#   scripts/migrate-config-order.sh --apply   print a Time Travel bookmark, then update D1
# Needs CLOUDFLARE_API_TOKEN (D1 Edit for --apply) and CLOUDFLARE_ACCOUNT_ID in the environment.
# Set D1_JSON_FILE to a saved `SELECT fp_shape, masked_config_json FROM config_catalog` result
# to skip the read (offline testing; dry run only).
set -euo pipefail

apply=false
case "${1:-}" in
  "") ;;
  --apply) apply=true ;;
  *)
    echo "usage: $0 [--apply]" >&2
    exit 2
    ;;
esac

# Rows per UPDATE: masked configs are at most ~3000 bytes, so a chunk stays well under D1's
# 2 MB bound-parameter limit.
CHUNK=200

sql="SELECT fp_shape, masked_config_json FROM config_catalog"

if [[ -n "${D1_JSON_FILE:-}" ]]; then
  if $apply; then
    echo "error: --apply cannot be used with D1_JSON_FILE" >&2
    exit 2
  fi
  raw="$(cat "$D1_JSON_FILE")"
else
  : "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
  : "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
  # Same lookup as export-public.sh: the wrangler config carries a placeholder database id.
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
  raw="$(api --header 'Content-Type: application/json' \
    --data "$(jq -nc --arg sql "$sql" '{sql: $sql}')" "${base}/${db_id}/query" | jq -ce '.result')"
fi

# Planned rows, one JSON object per line: {id, old, new}. Configs that do not parse are left alone
# (they are counted on stderr).
# shellcheck disable=SC2016
plan="$(printf '%s' "$raw" | jq -c '
  def canon:
    if type == "object" then to_entries | sort_by(.key) | map(.value |= canon) | from_entries
    elif type == "array" then map(canon)
    else . end;
  .[0].results[]
  | {id: .fp_shape, old: .masked_config_json,
     new: (.masked_config_json | try (fromjson | canon | tojson) catch null)}
  | select(.new != .old)
')"

total="$(printf '%s' "$raw" | jq '.[0].results | length')"
invalid="$(printf '%s\n' "$plan" | jq -s 'map(select(.new == null)) | length')"
plan="$(printf '%s\n' "$plan" | jq -c 'select(.new != null)')"
todo="$(printf '%s' "$plan" | jq -s 'length')"
echo "config_catalog: $total rows, $todo to rewrite, $invalid not valid JSON (left as is)" >&2

if ! $apply; then
  printf '%s' "$plan"
  [[ -n "$plan" ]] && echo
  echo "dry run: nothing written; re-run with --apply" >&2
  exit 0
fi

if [[ "$todo" -eq 0 ]]; then
  echo "nothing to do" >&2
  exit 0
fi

# Restore point: wrangler d1 time-travel restore gqlmd-telemetry --bookmark <bookmark>
bookmark="$(api "${base}/${db_id}/time_travel/bookmark" | jq -er '.result.bookmark')"
echo "time travel bookmark before the update: $bookmark" >&2

# The old value guards each row: a row rewritten since the read (by the daily rollup) is skipped.
update="UPDATE config_catalog SET masked_config_json = json_extract(m.value, '\$.new')
  FROM (SELECT value FROM json_each(?1)) AS m
  WHERE config_catalog.fp_shape = json_extract(m.value, '\$.id')
    AND config_catalog.masked_config_json = json_extract(m.value, '\$.old')"

changed=0
while IFS= read -r chunk; do
  body="$(jq -nc --arg sql "$update" --arg rows "$chunk" '{sql: $sql, params: [$rows]}')"
  n="$(api --header 'Content-Type: application/json' --data "$body" "${base}/${db_id}/query" \
    | jq -er '.result[0].meta.changes')"
  changed=$((changed + n))
# Each line is one chunk as a compact JSON array, bound as text for json_each.
done < <(printf '%s\n' "$plan" | jq -sc --argjson size "$CHUNK" '
  [range(0; length; $size) as $i | .[$i:$i + $size]] | .[]')

echo "rewrote $changed of $todo rows" >&2
if [[ "$changed" -lt "$todo" ]]; then
  echo "warning: $((todo - changed)) rows not rewritten; run the dry run again to see what is left" >&2
  exit 1
fi
