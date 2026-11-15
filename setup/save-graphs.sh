#!/usr/bin/env bash
# Saves Garnet's brand graph (published) and email graph (private) AS post@vegr.ai.
# The account's own login token proves who saves; it is read from D1 here and never printed.
#   ./setup/save-graphs.sh                    (both)
#   ./setup/save-graphs.sh brand-graph.json   (one; brand-graph.json has override:true, so it updates in place)
set -euo pipefail
cd "$(dirname "$0")"
TOKEN=$(cd /Volumes/T7/vegvisr-frontend && npx wrangler d1 execute vegvisr_org --remote --json \
  --command "SELECT emailVerificationToken FROM config WHERE email='post@vegr.ai'" 2>/dev/null \
  | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['results'][0]['emailVerificationToken'] or '')")
[ -n "$TOKEN" ] || { echo "post@vegr.ai has no login token"; exit 1; }
FILES=("$@"); [ ${#FILES[@]} -gt 0 ] || FILES=(brand-graph.json email-graph.json)
for f in "${FILES[@]}"; do
  printf '%s: ' "$f"
  curl -s -X POST https://knowledge.vegvisr.org/saveGraphWithHistory \
    -H "Content-Type: application/json" -H "X-API-Token: $TOKEN" -H "x-user-email: post@vegr.ai" \
    --data-binary @"$f"
  echo
done
