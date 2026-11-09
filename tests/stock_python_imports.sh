#!/usr/bin/env bash
# Every module a hook can import must load on macOS's stock /usr/bin/python3
# (3.9), because installed hooks run on it. On 2026-10-09 a fresh install's
# model-route hook crashed on every prompt: jev.py used `str | None` at module
# level, which 3.9 evaluates and rejects. A missing third-party package is an
# optional feature, not this bug, so only syntax and type errors fail here.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="${STOCK_PYTHON:-/usr/bin/python3}"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info < (3, 10) else 1)' 2>/dev/null || {
  echo "  skip  no Python older than 3.10 at $PY"; exit 0; }
fail=0
for f in "$ROOT"/bin/lib/*.py "$ROOT"/tools/agent_runtime.py "$ROOT"/tools/shared_checks.py "$ROOT"/tools/skill_route_shadow.py; do
  mod="$(basename "$f" .py)"
  err="$(cd "$(dirname "$f")" && "$PY" -I -c "import sys; sys.path[:0] = ['.', '$ROOT/bin/lib', '$ROOT/tools']; import $mod" 2>&1 >/dev/null)"
  case "$err" in
    ''|*ModuleNotFoundError*|*ImportError*) ;;
    *) echo "  FAIL  $mod: $(printf '%s' "$err" | tail -1)"; fail=1 ;;
  esac
done
[ "$fail" -eq 0 ] && echo "  ok   hook modules import on $("$PY" -V 2>&1)"
exit "$fail"
