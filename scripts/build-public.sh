#!/usr/bin/env bash
# Assemble the public stats site into <outdir>: page from public/, styling and assets shared with dashboard/,
# and stats.json from scripts/export-public.sh (honours D1_JSON_FILE; otherwise needs
# CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID).
#   scripts/build-public.sh <outdir>
set -euo pipefail

out="${1:?usage: build-public.sh <outdir>}"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$here")"

mkdir -p "$out/vendor"
for f in index.html public.js robots.txt CNAME favicon.ico; do
  if [[ -f "$repo/public/$f" ]]; then cp "$repo/public/$f" "$out/$f"; fi
done
cp "$repo/dashboard/style.css" "$repo/dashboard/logo.svg" "$repo/dashboard/favicon.ico" "$out/"
cp "$repo/dashboard/vendor/"* "$out/vendor/"
rm -f "$out/vendor/README.md"
touch "$out/.nojekyll"
"$here/export-public.sh" "$out/stats.json"
