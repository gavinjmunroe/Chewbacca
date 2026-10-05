#!/usr/bin/env bash
# doctor --json stays parseable when the secrets check finds something.
# On 2026-10-03 the leak list was printed as bare text ahead of the JSON
# object, so one flagged file made the whole report unreadable.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/.claude/skills/fake"
printf 'token = "ghp_%s"\n' "xxxxxxxxxxxxxxxxxxxxxxxx" > "$T/.claude/skills/fake/client.js"
env -i HOME="$T" PATH="$PATH" bash "$ROOT/doctor.sh" --json 2>/dev/null |
  python3 -c '
import json, sys
report = json.load(sys.stdin)
assert any("credential" in c["message"] for c in report["checks"]), "the leak was not reported"
'
