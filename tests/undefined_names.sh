#!/bin/bash
# No Python file in the kit may use a name it never defined.
#
# WHY. On 2026-10-03 a one-line edit to hud-listen's run_streamed appended
# `req.said` where only `said` was in scope. py_compile passes that, every
# script-mode test passed it, and at run time it raised NameError after every
# successful voice answer: each turn was reported failed and the carried
# conversation was never recorded. It surfaced two days later, only as one red
# pytest check that main had already learned to ignore. pyflakes finds it in
# under a second with no model and no running app.
#
# Extensionless scripts with a python shebang are copied to a temp dir with a
# .py suffix, because pyflakes only reads files it recognises as Python.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if python3 -c 'import pyflakes' 2>/dev/null; then
  RUN=(python3 -m pyflakes)
elif command -v uv >/dev/null 2>&1; then
  RUN=(uv run -q --no-project --with pyflakes python -m pyflakes)
else
  echo "skip: no pyflakes and no uv"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FILES=()
while IFS= read -r f; do
  case "$f" in
    *.py) FILES+=("$ROOT/$f") ;;
    */*.*) ;;
    *) head -1 "$ROOT/$f" 2>/dev/null | grep -q python \
         && cp "$ROOT/$f" "$TMP/$(printf '%s' "$f" | tr / _).py" ;;
  esac
done < <(git -C "$ROOT" ls-files bin tools mac hud/scripts)

# `undefined name '`, quoted: pyflakes also prints "unable to detect undefined
# names" for a star import, which is a limit of the scan, not a bug found.
OUT="$("${RUN[@]}" "${FILES[@]}" "$TMP" 2>&1 | grep "undefined name '" | sed "s|$TMP/||")"
if [ -n "$OUT" ]; then
  echo "FAIL: undefined names"
  printf '%s\n' "$OUT"
  exit 1
fi
echo "ok    no undefined names in the kit's Python"
