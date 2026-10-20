#!/usr/bin/env bash
#
# scripts/migrate-to-platform.sh
#
# Copies the dedup v2 files that need ZERO adapter changes from this repo
# into a target togari-platform checkout. Anything that needs hand-porting
# (BQ client adapter swaps, Slack merge, test framework rewrite) is printed
# at the end as a manual TODO list.
#
# Usage:
#   bash scripts/migrate-to-platform.sh /path/to/togari-platform
#   bash scripts/migrate-to-platform.sh /path/to/togari-platform --dry-run
#
# Safe to run twice; uses cp -n behavior via per-file existence checks.

set -euo pipefail

TARGET="${1:-}"
DRY_RUN=false
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then DRY_RUN=true; fi
done

if [[ -z "$TARGET" || "$TARGET" == "--dry-run" ]]; then
  echo "Usage: bash scripts/migrate-to-platform.sh <togari-platform-path> [--dry-run]" >&2
  exit 2
fi

if [[ ! -d "$TARGET" ]]; then
  echo "Error: target directory does not exist: $TARGET" >&2
  exit 2
fi

if [[ ! -f "$TARGET/package.json" ]]; then
  echo "Error: $TARGET does not look like a Node repo (no package.json)" >&2
  exit 2
fi

if ! grep -q "@togari/admin\|togari-platform" "$TARGET/package.json"; then
  echo "Warning: $TARGET/package.json doesn't mention @togari/admin or togari-platform." >&2
  echo "         Continuing anyway, but verify you're pointing at the right repo." >&2
fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "Source: $SRC"
echo "Target: $TARGET"
echo "Mode:   $(if $DRY_RUN; then echo "DRY RUN"; else echo "LIVE"; fi)"
echo ""

# ─── Helpers ─────────────────────────────────────────────────────────────────

copied=0
skipped=0
declare -a copied_paths=()

# copy_file <src_rel> <dest_rel>
copy_file() {
  local s="$SRC/$1"
  local d="$TARGET/$2"
  if [[ ! -f "$s" ]]; then
    echo "  [WARN] source missing: $1" >&2
    return
  fi
  if [[ -e "$d" ]]; then
    echo "  [SKIP] $2 already exists (overwrite manually if you want)"
    skipped=$((skipped+1))
    return
  fi
  if $DRY_RUN; then
    echo "  [DRY]  would copy $1 -> $2"
  else
    mkdir -p "$(dirname "$d")"
    cp "$s" "$d"
    echo "  [OK]   $2"
  fi
  copied=$((copied+1))
  copied_paths+=("$2")
}

# copy_dir <src_rel> <dest_rel>  (recursive, refuses to overwrite existing files)
copy_dir() {
  local s="$SRC/$1"
  local d="$TARGET/$2"
  if [[ ! -d "$s" ]]; then
    echo "  [WARN] source dir missing: $1" >&2
    return
  fi
  while IFS= read -r -d '' f; do
    local rel="${f#"$s"/}"
    local dest_rel="$2/$rel"
    copy_file "$1/$rel" "$dest_rel"
  done < <(find "$s" -type f -print0)
}

# ─── Mechanical copies — these files have no togari-bma-dvlp-specific deps ──

echo "== Copying verbatim files =="
copy_file "src/dnc/api/apple.routes.ts"       "src/transports/api/dedup/apple.routes.ts"
copy_file "src/dnc/api/magic-link.routes.ts"  "src/transports/api/dedup/magic-link.routes.ts"
copy_file "src/dnc/auth/api-key-middleware.ts" "src/auth/api-key-middleware.ts"
copy_file "src/dnc/integrations/carddav.ts"   "src/integrations/apple/carddav.ts"
copy_file "src/dnc/integrations/vcard.ts"     "src/integrations/apple/vcard.ts"
copy_file "src/dnc/dedup/realness.ts"            "src/dedup/realness.ts"
copy_file "src/dnc/dedup/realness.heuristics.ts" "src/dedup/realness.heuristics.ts"
copy_file "src/dnc/dedup/realness.haiku.ts"      "src/dedup/realness.haiku.ts"
copy_file "src/dnc/types/index.ts"            "src/dedup/types.ts"
copy_file "src/lib/env.ts"                    "src/lib/env.ts"
copy_file "scripts/smoke.ts"                  "scripts/smoke.ts"

echo ""
echo "== Copying dashboard =="
copy_dir  "src/dashboard"                     "src/dashboard"

echo ""
echo "== Copying chrome extension =="
copy_dir  "chrome-extension"                  "chrome-extension"

echo ""
echo "== Copying docs =="
copy_file "docs/HANDOFF.md"                   "docs/HANDOFF.md"
copy_file "docs/CLAY_INTEGRATION.md"          "docs/CLAY_INTEGRATION.md"
copy_file "docs/SLACK_BOT_COMMANDS.md"        "docs/SLACK_BOT_COMMANDS.md"
copy_file "docs/PARALLEL_BUILD_PLAN.md"       "docs/PARALLEL_BUILD_PLAN.md"

echo ""
echo "== Copying SQL migrations (RENAME to next available number on target side!) =="
copy_file "sql/migrations/004_dedup_v2_columns.sql"  "sql/migrations/004_dedup_v2_columns.sql"
copy_file "sql/migrations/005_owner_id_backfill.sql" "sql/migrations/005_owner_id_backfill.sql"

echo ""
echo "── Summary ──────────────────────────────────────────────────────────────"
echo "Copied:  $copied"
echo "Skipped: $skipped (already present on target)"

# ─── Manual port checklist ───────────────────────────────────────────────────

cat <<'MANUAL'

╔════════════════════════════════════════════════════════════════════════════╗
║ MANUAL PORT REQUIRED — these files were NOT copied because they need an    ║
║ adapter rewrite to use togari-platform's helpers (BQ client wrapper, JWT   ║
║ middleware, Sentry init, vitest, etc).                                     ║
╠════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  1. src/dnc/api/people.routes.ts                                           ║
║     → src/transports/api/dedup/people.routes.ts                            ║
║     Swap: validateApiKey import path; BQ client import.                    ║
║                                                                            ║
║  2. src/dnc/api/api-keys.routes.ts                                         ║
║     → src/transports/api/dedup/api-keys.routes.ts                          ║
║     Swap: Auth0 JWT validator to platform's auth/jwt.                      ║
║                                                                            ║
║  3. src/dnc/api/health.routes.ts                                           ║
║     → MERGE with any existing health route in togari-platform.             ║
║                                                                            ║
║  4. src/dnc/api/index.ts                                                   ║
║     → src/transports/api/dedup/index.ts; wire register functions into the  ║
║       existing apiRouter in src/transports/api/router.ts.                  ║
║                                                                            ║
║  5. src/dnc/dedup/matcher.ts                                               ║
║     → src/dedup/matcher.ts                                                 ║
║     Swap: BQ import to platform's BigQueryClient.                          ║
║                                                                            ║
║  6. src/dnc/auth/api-keys.ts                                               ║
║     → src/auth/api-keys.ts                                                 ║
║     Swap: BQ writes to platform's BigQueryClient.                          ║
║                                                                            ║
║  7. src/dnc/auth/apple-credentials.ts                                      ║
║     → src/secrets/apple-credentials.ts                                     ║
║     Swap: Secret Manager wrapper to platform's.                            ║
║                                                                            ║
║  8. src/dnc/integrations/slack-bot.ts                                      ║
║     → MERGE INTO src/transports/slack/index.ts                             ║
║     Add /togari command handler alongside existing Slack events.           ║
║                                                                            ║
║  9. src/dnc/workers/apple-sync.ts                                          ║
║     → src/workers/apple-sync.ts                                            ║
║     Swap: BQ writer + cache helpers.                                       ║
║                                                                            ║
║ 10. src/dnc/dedup/engine.ts + src/dnc/workers/{linkedin,instagram,twitter, ║
║     user}-sync.ts + bq-writer.ts + orchestrator.ts                         ║
║     → If togari-platform has its own sync workers, hand-port the           ║
║       owner_id parameterization pattern. Otherwise copy as src/workers/.   ║
║                                                                            ║
║ 11. src/__tests__/*.test.ts                                                ║
║     → Rewrite to vitest in tests/. Same assertions, swap test runner.      ║
║                                                                            ║
║ 12. scripts/claim-contacts.ts                                              ║
║     → scripts/claim-contacts.ts                                            ║
║     Swap: BQ client to platform's wrapper.                                 ║
║                                                                            ║
║ 13. src/index.ts                                                           ║
║     → MERGE INTO src/server.ts: call validateEnv() early, register the     ║
║       dedup routes with the existing apiRouter.                            ║
║                                                                            ║
║ 14. .env.example                                                           ║
║     → MERGE INTO platform's .env.example. Union both files; dedup.         ║
║                                                                            ║
║ 15. .github/workflows/ci.yml                                               ║
║     → MERGE INTO platform's CI workflow. Add typecheck + build + test.     ║
║                                                                            ║
║ 16. package.json scripts                                                   ║
║     → Add `smoke` and `claim-contacts` scripts to platform's package.json. ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
MANUAL

if $DRY_RUN; then
  echo ""
  echo "Dry run only. Re-run without --dry-run to actually copy files."
fi
