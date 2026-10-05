#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init launch-guard.sh 10
# PreToolUse: HARD BLOCK on launching, resuming or enrolling an outbound
# campaign unless the pre-send gate passed in full within the last 12 hours,
# on files that have not changed since.
#
# Written 2026-10-05. On 10-04 this kit called Jonah Graham's Zeutara lists
# "verified, pass the gate". Jonah's own review then found five things the gate
# never checked: 97 inboxes on domains he had refused, 19 personalized lines
# claiming investments that never happened, two CFOs, Sep 28 recipients emailed
# again, and no firm auto-pause. Sagar fixed all of it by hand. The lesson had
# already been written as prose twice (list-audit, list-guard), and list-guard
# is advisory, so neither stopped it.
#
# The gate (zeutara-gtme scripts/pre_send_gate.py) writes
# ~/.chewbacca/state/send-gate-receipt.json on a pass: "full" only when every
# check ran, plus a sha256 of every input file. 12 hours because lists change
# overnight and Monday's launch should not ride on Saturday's run.
#
# This is a guard against an agent forgetting, not against a determined one:
# it can't see a click made by hand in the Clay UI, and a browser MCP click
# carries no label, so on a Clay campaign page every MCP click is treated as a
# possible launch.

set -uo pipefail

payload="$(cat)"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
blob="$(printf '%s' "$payload" | jq -r '.tool_input // {} | tostring' 2>/dev/null)"
[ -n "$blob" ] || exit 0

state="$HOME/.chewbacca/state"
receipt="$state/send-gate-receipt.json"
lasturl="$state/launch-guard-last-url"
# Collapse whitespace so `chewie  web   click` matches like `chewie web click`.
lower="$(printf '%s' "$blob" | tr '[:upper:]' '[:lower:]' | tr -s ' \t\n' '   ')"
WORDS='launch|resume|unpause|activate|start campaign|start sending|enroll|add leads'

refuse() {
  printf 'launch-guard: %s\n' "$1" >&2
  exit 2
}

launching=0
case "$tool" in
  Bash)
    # The receipt is written by the gate and nothing else. A shell write to it
    # is a forged pass (security review, 2026-10-05).
    if printf '%s' "$lower" | grep -q 'send-gate-receipt'; then
      printf '%s' "$lower" | grep -q 'pre_send_gate.py' ||
        refuse "only scripts/pre_send_gate.py may touch the send-gate receipt."
    fi
    if printf '%s' "$lower" | grep -q 'chewie' &&
       printf '%s' "$lower" | grep -qE 'click|eval' &&
       printf '%s' "$lower" | grep -qE "$WORDS"; then
      launching=1
    fi
    if printf '%s' "$lower" | grep -qE '\bclay\b' &&
       printf '%s' "$lower" | grep -q 'campaign' &&
       printf '%s' "$lower" | grep -qE '"?status"? *[:= ] *"?active|\benroll|\blaunch|\bresume|\bstart\b'; then
      launching=1
    fi
    ;;
  mcp__peekaboo__*)
    case "$tool" in *click*|*type*|*hotkey*)
      printf '%s' "$lower" | grep -qE "$WORDS" && launching=1 ;;
    esac
    ;;
  mcp__chrome-devtools__*|mcp__plugin_playwright_playwright__*)
    url="$(printf '%s' "$payload" | jq -r '.tool_input.url // empty' 2>/dev/null)"
    case "$tool" in
      *navigate*|*new_page*)
        if [ -n "$url" ]; then
          mkdir -p "$state" 2>/dev/null
          printf '%s' "$url" > "$lasturl" 2>/dev/null
        fi
        exit 0 ;;
      *click*|*press_key*|*fill*|*type*|*evaluate*|*run_code*|*select_option*)
        last="$(cat "$lasturl" 2>/dev/null || true)"
        if printf '%s' "$last" | grep -qiE 'app\.clay\.com/.*campaign'; then
          launching=1
        fi
        ;;
    esac
    ;;
  *) exit 0 ;;
esac

[ "$launching" = 1 ] || exit 0

why=""
now=$(date +%s)
if [ ! -f "$receipt" ]; then
  why="no pre-send gate receipt at all."
else
  t=$(jq -r '.time // 0' "$receipt" 2>/dev/null || echo 0)
  full=$(jq -r '.full // false' "$receipt" 2>/dev/null || echo false)
  if [ "$full" != "true" ]; then
    why="the last gate pass skipped a check (no --suppress, --senders, --verification or --mx, or a --no-* flag)."
  elif [ $((now - t)) -ge 43200 ]; then
    why="the last full gate pass is over 12 hours old."
  else
    # Every input must still hash the same as when the gate passed.
    while IFS=$'\t' read -r path want; do
      [ -n "$path" ] || continue
      got=$(shasum -a 256 "$path" 2>/dev/null | awk '{print $1}')
      if [ "$got" != "$want" ]; then
        why="$(basename "$path") changed or vanished after the gate passed."
        break
      fi
    done < <(jq -r '.hashes // {} | to_entries[] | "\(.key)\t\(.value)"' "$receipt" 2>/dev/null)
    if [ -z "$why" ] && [ "$(jq -r '.hashes // {} | length' "$receipt" 2>/dev/null)" = "0" ]; then
      why="the receipt names no input files."
    fi
  fi
fi

[ -n "$why" ] || exit 0

cat >&2 <<MSG
launch-guard: refusing to launch, resume or enroll a campaign.

Why: $why

Run, from zeutara-gtme:

  clay campaigns options sender-accounts > /tmp/senders.json
  python3 scripts/pre_send_gate.py <lists>.csv --verification <verdicts>.csv \\
      --suppress <everyone already emailed>.csv --senders /tmp/senders.json --mx

The lists need title, personalized line and line_source columns. Before that,
read Jonah's and Sagar's latest Slack feedback and make sure every item is a
check the gate runs. On 2026-10-04 "passes our gate" meant only "passes the
checks we thought of", and Sagar fixed five defects by hand.
MSG
exit 2
