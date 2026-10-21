#!/usr/bin/env bash
# Smoke tests for medha-sandbox domains.
# Runs only what this environment can support; skips the rest with a note.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
SKIP=0

ok()   { echo "  PASS  $*"; PASS=$((PASS + 1)); }
bad()  { echo "  FAIL  $*"; FAIL=$((FAIL + 1)); }
skip() { echo "  SKIP  $*"; SKIP=$((SKIP + 1)); }

echo "== medha-sandbox smoke =="
echo "root: $ROOT"
echo

# --- structure ---
echo "[structure]"
for p in \
  domains/peoplerank \
  domains/messaging/messages2 \
  domains/messaging/messages2kit \
  domains/tizzy \
  domains/clearout \
  domains/clearout/web \
  ventures/core/amber-core \
  docs/DOMAIN_MAP.md \
  docs/EXTRACTION.md \
  docs/EVALUATION.md \
  docs/PROVENANCE.md \
  docs/DEPLOY.md
do
  if [[ -e "$ROOT/$p" ]]; then ok "$p"
  else bad "missing $p"
  fi
done
echo

# --- provenance files ---
echo "[provenance]"
for p in \
  domains/peoplerank/.provenance.json \
  domains/messaging/.provenance.json \
  domains/tizzy/.provenance.json \
  domains/clearout/.provenance.json \
  ventures/.provenance.json
do
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$ROOT/$p" 2>/dev/null; then
    ok "$p"
  else
    bad "invalid JSON $p"
  fi
done
echo

# --- peoplerank offline tests ---
echo "[peoplerank]"
if [[ -d "$ROOT/domains/peoplerank/tests" ]]; then
  if (cd "$ROOT/domains/peoplerank" && python3 -m unittest discover -s tests -v); then
    ok "peoplerank unittest"
  else
    bad "peoplerank unittest"
  fi
else
  bad "peoplerank tests/ missing"
fi
echo

# --- messages2kit (Swift; macOS only — SPM targets macOS 15+) ---
echo "[messages2kit]"
if [[ "$(uname -s)" == "Darwin" ]] && command -v swift >/dev/null 2>&1; then
  if (cd "$ROOT/domains/messaging/messages2kit" && swift test); then
    ok "swift test"
  else
    bad "swift test"
  fi
else
  skip "swift test (macOS toolchain required; $(uname -s))"
  if [[ -f "$ROOT/domains/messaging/messages2kit/Package.swift" ]]; then
    ok "Package.swift present"
  else
    bad "Package.swift missing"
  fi
  if [[ -f "$ROOT/domains/messaging/messages2kit/Tests/Messages2KitTests/SmokeTests.swift" ]]; then
    ok "SmokeTests.swift present"
  else
    bad "SmokeTests.swift missing"
  fi
fi
echo

# --- messages2 typecheck surface ---
echo "[messages2]"
if [[ -f "$ROOT/domains/messaging/messages2/package.json" ]]; then
  ok "messages2 package.json"
else
  bad "messages2 package.json missing"
fi
if [[ -f "$ROOT/domains/messaging/messages2/src/shared/types.ts" ]]; then
  ok "IPC types present"
else
  bad "IPC types missing"
fi
# Full npm test/typecheck needs macOS native modules — skip install here
skip "electron native build (macOS-only runtime)"
echo

# --- tizzy ---
echo "[tizzy]"
if [[ -f "$ROOT/domains/tizzy/package.json" ]]; then
  ok "tizzy web package.json"
else
  bad "tizzy web package.json missing"
fi
if [[ -f "$ROOT/domains/tizzy/mobile-app/package.json" ]]; then
  ok "tizzy mobile package.json"
else
  bad "tizzy mobile package.json missing"
fi
if [[ -f "$ROOT/domains/tizzy/mobile-app/Tizzy.ipa" ]]; then
  bad "Tizzy.ipa should be excluded from sandbox fold"
else
  ok "Tizzy.ipa excluded"
fi
if [[ -d "$ROOT/domains/tizzy/docs" ]] || [[ -f "$ROOT/domains/tizzy/docs/00-OVERVIEW.md" ]] || ls "$ROOT/domains/tizzy/docs" >/dev/null 2>&1; then
  ok "tizzy docs present"
else
  skip "tizzy docs path check"
fi
echo

# --- clearout ---
echo "[clearout]"
if [[ -f "$ROOT/domains/clearout/web/package.json" ]]; then
  ok "clearout web package.json"
else
  bad "clearout web package.json missing"
fi
if [[ -f "$ROOT/domains/clearout/web/vercel.json" ]]; then
  ok "clearout vercel.json"
else
  bad "clearout vercel.json missing"
fi
if [[ -d "$ROOT/domains/clearout/supabase/migrations" ]]; then
  ok "clearout supabase migrations"
else
  bad "clearout migrations missing"
fi
if [[ -d "$ROOT/domains/clearout/supabase/.temp" ]]; then
  bad "clearout supabase/.temp should be excluded"
else
  ok "supabase/.temp excluded"
fi
echo

# --- amber-core ---
echo "[amber-core]"
if [[ -f "$ROOT/ventures/core/amber-core/package.json" ]]; then
  ok "amber-core package.json"
else
  bad "amber-core package.json missing"
fi
if [[ -f "$ROOT/ventures/core/amber-core/packages/shared-types/src/index.ts" ]]; then
  ok "shared-types entry"
else
  bad "shared-types missing"
fi
echo

# --- deploy configs ---
echo "[deploy]"
for p in \
  domains/peoplerank/Dockerfile \
  domains/peoplerank/railway.json \
  domains/tizzy/vercel.json \
  .github/workflows/deploy-peoplerank.yml \
  .github/workflows/deploy-tizzy.yml \
  .github/workflows/deploy-clearout.yml
do
  if [[ -e "$ROOT/$p" ]]; then ok "$p"
  else bad "missing $p"
  fi
done
echo

echo "== summary: $PASS pass / $FAIL fail / $SKIP skip =="
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
