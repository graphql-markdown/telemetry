#!/usr/bin/env bash
# Queue UTC days for a re-roll. The ingest Worker's backfill cron rolls up one
# queued day every 10 minutes (oldest first) and drops days outside the
# Analytics Engine window (older than 88 days, or today and later).
#   scripts/backfill.sh FROM [TO]             queue FROM..TO (inclusive, YYYY-MM-DD; TO defaults to FROM)
#   scripts/backfill.sh --dry-run FROM [TO]   print the SQL, change nothing
#   scripts/backfill.sh --status              list the queued days
# Needs CLOUDFLARE_API_TOKEN (D1 Edit) and CLOUDFLARE_ACCOUNT_ID in the environment, and jq.
set -euo pipefail

query="$(dirname "$0")/query.sh"

dry_run=false
case "${1:-}" in
  --status)
    exec "$query" d1 "SELECT day, attempts FROM rollup_backfill ORDER BY day"
    ;;
  --dry-run)
    dry_run=true
    shift
    ;;
esac

from="${1:-}"
to="${2:-$from}"
usage() {
  echo "usage: $0 [--dry-run] FROM [TO] | --status" >&2
  exit 2
}
[[ -n "$from" && $# -le 2 ]] || usage

# One day per line, FROM..TO inclusive. jq validates the dates and caps the range.
days="$(jq -rn --arg from "$from" --arg to "$to" '
  def epoch: . as $d
    | if test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$") then strptime("%Y-%m-%d") | mktime else null end
    | if . != null and strftime("%Y-%m-%d") == $d then . else error("invalid day: \($d)") end;
  ($from | epoch) as $f | ($to | epoch) as $t
  | if $t < $f then error("TO is before FROM")
    elif ($t - $f) / 86400 >= 90 then error("range longer than 90 days")
    else range($f; $t + 1; 86400) | strftime("%Y-%m-%d") end
')" || usage

values="$(printf "('%s')," $days)"
sql="INSERT OR IGNORE INTO rollup_backfill (day) VALUES ${values%,}"

if $dry_run; then
  echo "$sql"
  exit 0
fi
"$query" d1 "$sql"
echo "queued $(wc -w <<<"$days" | tr -d ' ') day(s); one is rolled up every 10 minutes" >&2
