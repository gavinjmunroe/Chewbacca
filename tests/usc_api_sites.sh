#!/bin/bash
# The USC sites the kit ships must work for any student in any term: no op
# pinned to one person's Chrome profile in its instructions, WebReg readable
# for whatever term a student names, and calendar search looking ahead.
# Reads the specs only, no network. The safety check runs against a temp engine.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
no() { echo "FAIL: $*"; fail=1; }
S="$ROOT/library/api-sites"

# handshake.md told every student to log in with --profile "Chrome/Profile 1",
# which is one Mac's profile name (2026-10-10).
for f in "$S"/brightspace.* "$S"/handshake.* "$S"/usc-*.* "$S"/sc-engage.* "$S"/rmp.*; do
  [ -f "$f" ] || continue
  hits="$(grep -nE 'Profile [0-9]|Work (Chrome )?profile' "$f")"
  [ -z "$hits" ] || no "$(basename "$f") names one student's Chrome profile: $hits"
done

python3 - "$S" <<'PY' || fail=1
import json, sys
S = sys.argv[1]
bad = []
reg = {o["name"]: o for o in json.load(open(f"{S}/usc-reg.json"))["operations"]}
# Ops pinned to Fall 2026 and Spring 2027 would stop answering the moment a
# student registers for Fall 2027. Each read takes the term instead.
for name in ("registrationAppointment", "holds", "schedule", "courseBin"):
    o = reg.get(name)
    if not o:
        bad.append(f"usc-reg has no {name}(term)"); continue
    if [p["name"] for p in o["params"]] != ["term"]:
        bad.append(f"usc-reg.{name} should take exactly term")
    if "{term}" not in o["trigger"]["url"] or "TermSelect" not in o["trigger"]["url"]:
        bad.append(f"usc-reg.{name} trigger does not select the asked term")
    if not any(s.get("param") == "term" and s["at"] == ["query:term"] for s in o["slots"]):
        bad.append(f"usc-reg.{name} has no term slot, so the engine can't tell which term answered")
    if o.get("minTier") != 3 or o.get("readOnly") is not True:
        bad.append(f"usc-reg.{name} must stay read-only at tier 3 (plain HTTP answers for the last selected term)")
# The pinned copies were removed once the term ops existed (2026-10-10); one
# coming back is a Fall-2026-only op a student would call in Spring.
import re
pinned = [n for n in reg if re.search(r"(Spring|Summer|Fall)\d{4}$", n)]
if pinned:
    bad.append(f"usc-reg has term-pinned ops again: {pinned}")
# Localist search without a days window answers for today only: "music",
# "football" and "concert" all came back [] on 2026-10-10.
ev = {o["name"]: o for o in json.load(open(f"{S}/usc-events.json"))["operations"]}["searchEvents"]
for u in (ev["request"]["url"], ev["trigger"]["url"]):
    if "days=" not in u:
        bad.append(f"usc-events.searchEvents has no days window: {u}")
for b in bad:
    print("FAIL:", b)
sys.exit(1 if bad else 0)
PY

# The term ops still pass the kit's safety check, so sync installs them.
if command -v node >/dev/null 2>&1; then
  mkdir -p "$T/kit" "$T/engine/sites" "$T/bin"
  printf '#!/bin/bash\necho "{\\"ok\\":true}"\n' > "$T/bin/api-anything"; chmod +x "$T/bin/api-anything"
  cp "$S/usc-reg.json" "$S/usc-events.json" "$S/hosts.allow" "$T/kit/"
  err="$(PATH="$T/bin:$PATH" API_ANYTHING_HOME="$T/engine" CHEWBACCA_API_SITES="$T/kit" bash "$ROOT/bin/chewbacca-api" sync 2>&1 >/dev/null)"
  [ -f "$T/engine/sites/usc-reg.json" ] || no "sync refused usc-reg: $err"
  [ -f "$T/engine/sites/usc-events.json" ] || no "sync refused usc-events: $err"
fi

[ "$fail" -eq 0 ] && echo "usc api sites: ok"
exit "$fail"
