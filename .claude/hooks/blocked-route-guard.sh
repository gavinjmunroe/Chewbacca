#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init blocked-route-guard.sh 10
# Stop hook: a BLOCKED: that hands Caleb a click must show the kit's routes
# to that click were tried first.
#
# WHAT HAPPENED, 2026-10-16, minutes before a live client demo. Two replies
# in one tab:
#
#   12:35 "BLOCKED: hiding columns in Clay can only be done in its UI, and
#          Claude in Chrome isn't connected, so that click has to happen on
#          ur screen."
#   12:42 "BLOCKED: the only Clay login is in the window on ur screen, so the
#          cleanup has to be done by u, about 90 sec: Sort: click the icon..."
#
# Caleb: "BRO U HV JEV BROWSER AGENT ... WE LITERALLY MAPPED OUT NAVIGATING
# CLAY UX", then "Why can't you do it?", "Jev browser agent?", "I thought we
# had reverse engineered clay wtf?". The kit had `chewbacca clay` (Clay's own
# API, no tab), jev-browse (his signed-in Chrome) and the browser pane. One
# route failing became a blocker, and the click became his.
#
# WHAT IT ENFORCES. A reply whose BLOCKED: hands him a UI step (click, sort,
# hide, toggle, "on ur screen", "has to be done by u") must name at least two
# of the kit's routes it tried and how each failed. One failure is a reason to
# try the next route, not a blocker. Refuses once per stop.

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
[ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty')
printf '%s' "$MSG" | grep -q 'BLOCKED:' || exit 0

VERDICT=$(BR_MSG="$MSG" python3 -I - <<'PY'
import os, re
msg = os.environ["BR_MSG"]
UI = re.compile(r"\bclick\b|\bon (?:ur|your) screen\b|\bin (?:its|the) UI\b|\bhas to (?:be done by|happen on) (?:u|you|ur)\b"
                r"|\b(?:sort|hide|toggle|drag) (?:the|it|them)\b", re.I)
if not UI.search(msg):
    print("ok"); raise SystemExit
ROUTES = {
    "chewbacca clay": r"chewbacca clay|clay(?:'s)? (?:api|cli)\b|\bclay [a-z-]+ op\b",
    "jev-browse": r"\bjev(?:-browse| browse| browser)?\b",
    "browser pane": r"browser pane|built-in browser|in-app browser",
    "claude in chrome": r"claude in chrome|chrome extension",
    "peekaboo": r"\bpeekaboo\b",
    "computer use": r"computer[- ]use",
    "api-anything": r"api-anything",
    "chrome devtools": r"devtools|chrome-js",
}
tried = [k for k, p in ROUTES.items() if re.search(p, msg, re.I)]
print("ok" if len(tried) >= 2 else "one:" + (",".join(tried) or "none"))
PY
)

case "$VERDICT" in
  one:*)
    {
      echo "blocked-route-guard: refusing. This BLOCKED: hands Caleb a UI step after"
      echo "trying ${VERDICT#one:} of the kit's routes to it."
      echo
      echo "On 2026-10-16, before a live demo, a Clay sort and column hide were handed to"
      echo "him twice while chewbacca clay and jev-browse were right there. He wrote"
      echo "\"Why can't you do it?\" and \"I thought we had reverse engineered clay wtf?\""
      echo
      echo "Try the next route now: chewbacca clay <op> (Clay's API, no tab), jev-browse"
      echo "(his signed-in Chrome), the browser pane, peekaboo, computer use. If two or"
      echo "more truly fail, name each one and how it failed in the reply, then hand it over."
    } >&2
    exit 2 ;;
esac
exit 0
