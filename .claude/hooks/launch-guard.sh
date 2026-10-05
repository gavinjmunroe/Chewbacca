#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init launch-guard.sh 10
# PreToolUse: HARD BLOCK on launching, resuming or enrolling an outbound
# campaign unless the pre-send gate passed in full within the last 12 hours.
#
# Written 2026-10-05. On 10-04 this kit called Jonah Graham's Zeutara lists
# "verified, pass the gate". Jonah's own review then found five things the gate
# never checked: 97 inboxes on domains he had refused, 19 personalized lines
# claiming investments that never happened, two CFOs, Sep 28 recipients emailed
# again, and no firm auto-pause. Sagar fixed all of it by hand. The lesson had
# already been written as prose twice (list-audit, list-guard), and list-guard
# is advisory, so neither stopped it.
#
# The gate (zeutara-gtme scripts/pre_send_gate.py) now refuses all five, and
# writes ~/.chewbacca/state/send-gate-receipt.json on a pass. A receipt counts
# only when "full" is true: senders checked, prior sends suppressed (or
# --first-send), titles and lines present. 12 hours because lists change
# overnight and Monday's launch should not ride on Saturday's run.

set -uo pipefail

payload="$(cat)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
blob="$(printf '%s' "$payload" | jq -r '.tool_input // {} | tostring' 2>/dev/null)"
[ -n "$blob" ] || exit 0

case "$tool" in
  Bash|mcp__peekaboo__*) ;;
  *) exit 0 ;;
esac

lower="$(printf '%s' "$blob" | tr '[:upper:]' '[:lower:]')"

launching=0
if [ "$tool" = "Bash" ]; then
  # A browser click whose label starts a send.
  if printf '%s' "$lower" | grep -qE 'chewie web click[^|;&]*(launch|resume|unpause|activate|start campaign|start sending|enroll|add leads)'; then
    launching=1
  fi
  # The clay CLI setting a campaign live or enrolling leads.
  if printf '%s' "$lower" | grep -qE '(^|[;&| "])clay campaigns [^|;&]*(--status[ =]"?active|"status" *: *"active"|\benroll|\blaunch|\bresume|\bstart\b)'; then
    launching=1
  fi
else
  # peekaboo clicking a launch-like label in the Clay app
  if printf '%s' "$lower" | grep -qE '(launch|resume|unpause|activate|start campaign|enroll)'; then
    case "$tool" in *click*) launching=1 ;; esac
  fi
fi

[ "$launching" = 1 ] || exit 0

receipt="$HOME/.chewbacca/state/send-gate-receipt.json"
now=$(date +%s)
if [ -f "$receipt" ]; then
  t=$(jq -r '.time // 0' "$receipt" 2>/dev/null || echo 0)
  full=$(jq -r '.full // false' "$receipt" 2>/dev/null || echo false)
  if [ "$full" = "true" ] && [ $((now - t)) -lt 43200 ]; then
    exit 0
  fi
fi

cat >&2 <<'MSG'
launch-guard: refusing to launch, resume or enroll a campaign.

No FULL pre-send gate pass in the last 12 hours. Run, from zeutara-gtme:

  clay campaigns options sender-accounts > /tmp/senders.json
  python3 scripts/pre_send_gate.py <lists>.csv --verification <verdicts>.csv \
      --suppress <everyone already emailed>.csv --senders /tmp/senders.json --mx

The lists need title, personalized line and line_source columns. Before that,
read Jonah's and Sagar's latest Slack feedback and make sure every item is a
check the gate runs. On 2026-10-04 "passes our gate" meant only "passes the
checks we thought of", and Sagar fixed five defects by hand.
MSG
exit 2
