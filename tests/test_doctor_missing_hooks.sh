#!/usr/bin/env bash
# doctor fails a registered hook whose script is gone. Break-it, 2026-10-19:
# deleting one hook script, or all 90, left doctor's fail count unchanged, and
# it printed "Stop wired (not via stop-check.sh)" for the missing file.
set -u
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/.claude/hooks"
printf '#!/bin/sh\nexit 0\n' > "$T/.claude/hooks/present.sh"; chmod +x "$T/.claude/hooks/present.sh"
cat > "$T/.claude/settings.json" <<JSON
{"hooks": {"Stop": [{"hooks": [
  {"type": "command", "command": "$T/.claude/hooks/present.sh"},
  {"type": "command", "command": "\$HOME/.claude/hooks/gone-guard.sh"}]}]}}
JSON
env -i HOME="$T" PATH="$PATH" bash "$ROOT/doctor.sh" --json 2>/dev/null > "$T/out" || true
python3 - "$T/out" <<'PY'
import json, sys
checks = json.load(open(sys.argv[1]))["checks"]
hit = [c for c in checks if "registered hook script" in c["message"]]
if not hit or hit[0].get("status") == "pass":
    sys.exit("FAIL  a missing hook script was not reported: %s" % [c["message"] for c in hit])
if "gone-guard.sh" not in hit[0]["message"] or "present.sh" in hit[0]["message"]:
    sys.exit("FAIL  wrong script named: %s" % hit[0]["message"])
print("ok    doctor fails a registered hook whose script is missing")
PY
