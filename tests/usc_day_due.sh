#!/bin/bash
# The `chewbacca usc` day screen's "Due this week" reads Brightspace through
# the Chrome session lockin uses, and a signed-out student gets one plain
# line. On the 2026-10-13 USC week walk it went through the api engine and
# printed "HTTP 403 with no login or challenge markers: { Errors: ... }".
# No pipefail: `printf | grep -q` fails at random under it when grep quits before printf finishes.
set -u
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "  ok   $1"; }; no() { echo "  FAIL $1"; fail=1; }
PY=/usr/bin/python3
export HOME="$T/home" CHEWBACCA_CHROME_DIR="$T/chrome" BRIGHTSPACE_STATE="$T/state" BRIGHTSPACE_DELAY=0,0 CHEWBACCA_NO_OPEN=1
unset CHEWIE_CHROME_PROFILE CHEWBACCA_ROOT BRIGHTSPACE_FIXTURE
mkdir -p "$HOME" "$T/chrome"
$PY - "$T/fx.json" <<'PY'
import datetime as d, json, sys
now = d.datetime.now(d.timezone.utc)
iso = lambda days: (now + d.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
E = {"Items": [{"OrgUnit": {"Id": 705, "Name": "20263_52300 PSYC-100: Intro Psych", "Code": "20263_52300"},
                "Access": {"IsActive": True}}], "PagingInfo": {"HasMoreItems": False}}
cal = {"Objects": [{"Title": "Quiz 3", "StartDateTime": iso(2)}, {"Title": "Term paper", "StartDateTime": iso(30)}]}
json.dump({"/lp/1.63/enrollments/myenrollments/": E,
           "/lp/1.43/enrollments/myenrollments/?orgUnitTypeId=3&pageSize=100": E,
           "/le/1.99/705/calendar/events/myEvents/": cal}, open(sys.argv[1], "w"))
PY
day() { $PY - "$ROOT" <<'PY'
import datetime as dt, importlib.machinery, importlib.util, json, sys
sys.dont_write_bytecode = True
l = importlib.machinery.SourceFileLoader("usc", sys.argv[1] + "/bin/chewbacca-usc")
m = importlib.util.module_from_spec(importlib.util.spec_from_loader("usc", l)); l.exec_module(m)
r = m.due(dt.date.today())
print(json.dumps(r)); print(m.render({"due": r, "food": {"meal": "Lunch", "hall": "Village"}, "events": {"items": []}}))
PY
}
out="$(BRIGHTSPACE_FIXTURE="$T/fx.json" day 2>&1)"
printf '%s' "$out" | grep -q '"title": "Quiz 3"' && ! printf '%s' "$out" | grep -q "Term paper" \
  && ok "due this week comes from the Chrome session, this week only" || no "due from session: $out"
out="$(day 2>&1)"
printf '%s' "$out" | grep -q "^  Brightspace says you're signed out. Open brightspace.usc.edu in Chrome" \
  && ! printf '%s' "$out" | grep -qi "HTTP\|Errors\|challenge markers" \
  && ok "a signed-out student gets one plain line, no server text" || no "signed out: $out"
exit "$fail"
