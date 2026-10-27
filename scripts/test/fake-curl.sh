#!/usr/bin/env bash
# Stands in for curl against the Cloudflare D1 API in migrate-config-order tests.
# Answers the database lookup, the SELECT (from FAKE_D1_JSON) and the bookmark. UPDATE bodies
# are appended to FAKE_LOG and, when FAKE_DB is set, run there with sqlite3 (?1 inlined as a
# quoted literal); without FAKE_DB, one change is reported per row in the bound chunk.
set -euo pipefail

data=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --data | --header) [[ "$1" == --data ]] && data="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done

case "$url" in
  *"?name=gqlmd-telemetry") echo '{"result":[{"name":"gqlmd-telemetry","uuid":"db"}]}' ;;
  */time_travel/bookmark) echo '{"result":{"bookmark":"bm-1"}}' ;;
  */query)
    if [[ "$(jq -r .sql <<<"$data")" == SELECT* ]]; then
      jq -c '{result: .}' "$FAKE_D1_JSON"
      exit 0
    fi
    printf '%s\n' "$data" >> "$FAKE_LOG"
    if [[ -n "${FAKE_DB:-}" ]]; then
      sql="$(jq -r --arg q "'" '(.params[0] | gsub($q; $q + $q)) as $p | .sql | sub("\\?1"; $q + $p + $q)' <<<"$data")"
      n="$(sqlite3 "$FAKE_DB" "$sql; SELECT changes();")"
    else
      n="$(jq '.params[0] | fromjson | length' <<<"$data")"
    fi
    printf '{"result":[{"meta":{"changes":%s}}]}\n' "$n"
    ;;
  *)
    echo "fake curl: unexpected url: $url" >&2
    exit 1
    ;;
esac
