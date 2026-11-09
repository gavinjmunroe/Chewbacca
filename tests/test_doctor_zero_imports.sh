#!/usr/bin/env bash
# doctor reports a CLAUDE.md with no @ imports instead of passing it.
# 2026-10-12, stranger test: after `setup.sh --runtime claude-code` the
# CLAUDE.md held no @ lines. `grep -c` printed 0 and exited 1, so
# `|| echo 0` appended a second 0, `[ "0<newline>0" -eq 0 ]` errored with
# "integer expression expected", and doctor printed "pass  CLAUDE.md
# declares 0 0 imports" for an install that loads no standards.
set -u
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/.claude"
printf '# My instructions\n\nNo imports here.\n' > "$T/.claude/CLAUDE.md"
env -i HOME="$T" PATH="$PATH" bash "$ROOT/doctor.sh" --json 2>"$T/err" > "$T/out" || true
if grep -q "integer expression expected" "$T/err"; then
  echo "FAIL  doctor crashed counting CLAUDE.md imports: $(grep -m1 'integer expression' "$T/err")"
  exit 1
fi
python3 - "$T/out" <<'PY'
import json, sys
checks = json.load(open(sys.argv[1]))["checks"]
hit = [c for c in checks if "no @ imports" in c["message"]]
if not hit:
    passed = [c["message"] for c in checks if "imports" in c["message"]]
    sys.exit("FAIL  a CLAUDE.md with no imports was not reported; import checks said: %s" % passed)
if hit[0].get("status") == "pass":
    sys.exit("FAIL  the no-imports finding was marked pass")
print("ok    doctor reports a CLAUDE.md with no @ imports")
PY
