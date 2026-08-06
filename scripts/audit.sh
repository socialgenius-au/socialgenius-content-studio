#!/usr/bin/env bash
set -uo pipefail

# --- EDIT THESE if they've changed ---
BACKEND_URL="https://socialgenius-content-studio-production.up.railway.app"
FRONTEND_URL=""   # paste the frontend's Railway domain here if you have it

echo "=========================================="
echo "CONTENT STUDIO AUDIT — $(date)"
echo "=========================================="

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$ROOT" ]; then
  echo "ERROR: not inside a git repo. cd into socialgenius-content-studio first."
  exit 1
fi
cd "$ROOT"

echo ""
echo "--- REPO ---"
echo "Path: $ROOT"
echo "Remote: $(git remote get-url origin 2>/dev/null)"
echo "Branch: $(git branch --show-current)"
echo "Last commit: $(git log -1 --format='%h %ci %s' 2>/dev/null)"
echo ""
echo "--- UNCOMMITTED CHANGES ---"
git status --short || echo "(clean)"
echo ""
echo "--- LAST 15 COMMITS ---"
git log -15 --format='%h  %ci  %s' 2>/dev/null

echo ""
echo "=========================================="
echo "TOP-LEVEL STRUCTURE"
echo "=========================================="
find . -maxdepth 2 -not -path '*/node_modules*' -not -path '*/.git*' -not -path '*/__pycache__*' -not -path '*/.venv*' | sort

echo ""
echo "=========================================="
echo "BACKEND"
echo "=========================================="

echo "--- requirements.txt ---"
cat backend/requirements.txt 2>/dev/null || echo "(not found at backend/requirements.txt)"

echo ""
echo "--- Uvicorn worker count ---"
grep -rn "workers" backend --include="*.py" --exclude-dir=.venv 2>/dev/null

echo ""
echo "--- CORS config ---"
grep -rn "allow_origins\|CORSMiddleware" backend --include="*.py" --exclude-dir=.venv -A2 2>/dev/null

echo ""
echo "--- All API routes defined in code ---"
grep -rn "@router\.\(get\|post\|put\|delete\|patch\)\|@app\.\(get\|post\|put\|delete\|patch\)" backend --include="*.py" --exclude-dir=.venv 2>/dev/null

echo ""
echo "--- Router/service files present ---"
find backend \( -path '*routers*' -o -path '*routes*' -o -iname '*_svc.py' -o -iname '*service*.py' \) -not -path '*__pycache__*' -not -path '*/.venv/*' 2>/dev/null | sort

echo ""
echo "--- Merge feature check (built earlier today) ---"
grep -rln "merge_with_transitions\|MergeRequest\|MergeResponse\|process/merge" backend --include="*.py" --exclude-dir=.venv 2>/dev/null || echo "NOT FOUND — merge feature missing from this checkout"

echo ""
echo "--- Env vars referenced in code ---"
grep -rohE "(os\.getenv|os\.environ\.get)\(['\"][A-Z_]+['\"]" backend --include="*.py" --exclude-dir=.venv 2>/dev/null | grep -oE "['\"][A-Z_]+['\"]" | tr -d "'\"" | sort -u

echo ""
echo "--- Integration wiring check ---"
for term in canva beehiiv gmb google_my_business apify pixabay whisper elevenlabs; do
  count=$(grep -rli "$term" backend --include="*.py" --exclude-dir=.venv 2>/dev/null | wc -l)
  echo "$term: $count file(s)"
done

echo ""
echo "--- TODO / FIXME / HACK (backend) ---"
grep -rn "TODO\|FIXME\|HACK" backend --include="*.py" --exclude-dir=.venv 2>/dev/null

echo ""
echo "=========================================="
echo "FRONTEND"
echo "=========================================="

echo "--- package.json scripts ---"
grep -A20 '"scripts"' frontend/package.json 2>/dev/null

echo ""
echo "--- VITE_API_URL usage ---"
grep -rn "VITE_API_URL" frontend --include="*.ts" --include="*.tsx" --exclude-dir=node_modules 2>/dev/null

echo ""
echo "--- Key studio components ---"
for comp in Timeline PreviewCanvas ChatBar TextOverlayEditor MediaOverlayEditor; do
  found=$(find frontend -iname "${comp}*" -not -path '*node_modules*' 2>/dev/null)
  [ -n "$found" ] && echo "$comp: FOUND ($found)" || echo "$comp: MISSING"
done

echo ""
echo "--- Publishing components ---"
find frontend -iname "*publish*" -not -path '*node_modules*' 2>/dev/null

echo ""
echo "--- TODO / FIXME (frontend) ---"
grep -rn "TODO\|FIXME\|HACK" frontend/src --include="*.ts" --include="*.tsx" --exclude-dir=node_modules 2>/dev/null

echo ""
echo "=========================================="
echo "DEPLOY CONFIG"
echo "=========================================="
for f in backend/railway.toml frontend/railway.toml backend/Dockerfile frontend/Dockerfile backend/Procfile frontend/Procfile railway.json backend/railway.json frontend/railway.json backend/nixpacks.toml; do
  if [ -f "$f" ]; then
    echo "--- $f ---"
    cat "$f"
    echo ""
  fi
done

echo ""
echo "=========================================="
echo "LIVE ENDPOINT CHECK"
echo "=========================================="
echo "--- Backend: $BACKEND_URL ---"
curl -s -o /dev/null -w "HTTP %{http_code}  (%{time_total}s)\n" "$BACKEND_URL/docs" 2>/dev/null || echo "curl failed / backend unreachable"
echo ""
echo "Live routes (from deployed openapi.json):"
curl -s "$BACKEND_URL/openapi.json" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print('\n'.join(sorted(d.get('paths',{}).keys())))" 2>/dev/null || echo "(could not fetch/parse — backend may be down)"

if [ -n "$FRONTEND_URL" ]; then
  echo ""
  echo "--- Frontend: $FRONTEND_URL ---"
  curl -s -o /dev/null -w "HTTP %{http_code}  (%{time_total}s)\n" "$FRONTEND_URL" 2>/dev/null || echo "curl failed / frontend unreachable"
fi

echo ""
echo "=========================================="
echo "AUDIT COMPLETE — copy everything above and paste it back to Claude"
echo "=========================================="
