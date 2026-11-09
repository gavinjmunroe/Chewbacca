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
# The 2026-10-13 stack pass: parking, rec traffic and the campus map. Each is
# read-only, and the two that call a vendor's host send no cookie there.
for site, ops in (("usc-parking", ("account", "activePermits")), ("usc-rec", ("facilityTraffic",)),
                  ("usc-maps", ("searchPlaces",))):
    try:
        spec = {o["name"]: o for o in json.load(open(f"{S}/{site}.json"))["operations"]}
    except OSError:
        bad.append(f"{site}.json is missing"); continue
    for name in ops:
        o = spec.get(name)
        if not o:
            bad.append(f"{site} has no {name}"); continue
        if o.get("readOnly") is not True:
            bad.append(f"{site}.{name} is not read-only")
        if site != "usc-parking" and "cookie" in json.dumps(o.get("slots", [])):
            bad.append(f"{site}.{name} sends a cookie to {o['request']['url'].split('/')[2]}")
# A guest AIMS answer is ok true with no account in it; signedIn is how the
# wrapper tells it from a student with no permits (2026-10-13).
acct = {o["name"]: o for o in json.load(open(f"{S}/usc-parking.json"))["operations"]}.get("account", {})
if "signedIn=user.logged_in" not in acct.get("response", {}).get("pick", []):
    bad.append("usc-parking.account does not report signedIn, so a guest answer reads as an empty account")
# The map search takes the student's words, not a pinned building.
maps = {o["name"]: o for o in json.load(open(f"{S}/usc-maps.json"))["operations"]}.get("searchPlaces", {})
if [p["name"] for p in maps.get("params", [])] != ["q"]:
    bad.append("usc-maps.searchPlaces should take exactly q")
# USC-STACK.md is what agents and the report read for "can Chewbacca do X".
# A row marked yes that names an op no spec has would send a student to a
# call that fails.
import glob, os
known = set()
for f in glob.glob(f"{S}/*.json"):
    try:
        d = json.load(open(f))
    except ValueError:
        continue
    if isinstance(d, dict):
        for o in d.get("operations") or []:
            known.add(f"{os.path.basename(f)[:-5]}.{o['name']}")
rows = [l for l in open(f"{S}/USC-STACK.md") if l.startswith("|") and "---" not in l]
for row in rows[1:]:
    cells = [c.strip() for c in row.strip().strip("|").split("|")]
    if len(cells) < 4 or cells[2] != "yes":
        continue
    named = re.findall(r"`([a-z-]+\.[A-Za-z]+)`", cells[3])
    if not named:
        bad.append(f"USC-STACK.md marks {cells[0]} yes with no op")
    for n in named:
        if n not in known:
            bad.append(f"USC-STACK.md marks {cells[0]} yes, but no spec has {n}")
for b in bad:
    print("FAIL:", b)
sys.exit(1 if bad else 0)
PY

# The term ops still pass the kit's safety check, so sync installs them.
if command -v node >/dev/null 2>&1; then
  mkdir -p "$T/kit" "$T/engine/sites" "$T/bin"
  printf '#!/bin/bash\necho "{\\"ok\\":true}"\n' > "$T/bin/api-anything"; chmod +x "$T/bin/api-anything"
  cp "$S/usc-reg.json" "$S/usc-events.json" "$S/usc-parking.json" "$S/usc-rec.json" "$S/usc-maps.json" "$S/hosts.allow" "$T/kit/"
  err="$(PATH="$T/bin:$PATH" API_ANYTHING_HOME="$T/engine" CHEWBACCA_API_SITES="$T/kit" bash "$ROOT/bin/chewbacca-api" sync 2>&1 >/dev/null)"
  [ -f "$T/engine/sites/usc-reg.json" ] || no "sync refused usc-reg: $err"
  [ -f "$T/engine/sites/usc-events.json" ] || no "sync refused usc-events: $err"
  for s in usc-parking usc-rec usc-maps; do
    [ -f "$T/engine/sites/$s.json" ] || no "sync refused $s: $err"
  done
fi

[ "$fail" -eq 0 ] && echo "usc api sites: ok"
exit "$fail"
