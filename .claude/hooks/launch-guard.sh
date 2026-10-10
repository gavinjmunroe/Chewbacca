#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init launch-guard.sh 10
# lib.sh's watchdog ends a slow hook with exit 0, which for this hook would let
# a launch through whenever the grade check is slow (security review,
# 2026-10-10). A guard that times out refuses instead.
trap 'echo "launch-guard: timed out verifying the gate, refusing" >&2; exit 2' TERM
# PreToolUse: HARD BLOCK on launching, resuming or enrolling an outbound
# campaign unless the pre-send gate passed in full within the last 12 hours,
# on files that have not changed since, AND gtme-grade passed all five
# playbook gates for that campaign in the same window (see below).
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
# No jq, or a payload jq cannot parse, means no receipt check either, so fail
# closed on anything launch-like (security review, 2026-10-10: an unparsable
# payload used to fall through to exit 0).
blind() {
  printf '%s' "$payload" | tr '[:upper:]' '[:lower:]' |
    grep -qE 'launch|resume|unpause|enroll|add.leads|activ|start|send-gate-receipt|gtme-grade' &&
    { echo "launch-guard: $1, cannot verify a gate pass" >&2; exit 2; }
  exit 0
}
command -v jq >/dev/null 2>&1 || blind "jq is missing"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)" || blind "the hook payload is not JSON"
blob="$(printf '%s' "$payload" | jq -r '.tool_input // {} | tostring' 2>/dev/null)" || blind "the hook payload is not JSON"
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
    # The receipt and the last-URL state are written by the gate and this hook,
    # never by a shell command. The gate writes from inside Python, so its own
    # command line never names the file, and no mention is exempt: an earlier
    # version exempted commands naming pre_send_gate.py, which a comment could
    # fake (security review, 2026-10-05).
    if printf '%s' "$lower" | grep -qE 'send-gate-receipt|launch-guard-last-url'; then
      refuse "only scripts/pre_send_gate.py may write the send-gate receipt."
    fi
    # Same for the grade receipts, which only tools/gtme_grade.py writes.
    # The receipts are signed, so a forged one fails --verify anyway; the key is
    # what must never be read or written from a shell.
    if printf '%s' "$lower" | grep -qE 'state/gtme-grade|state" *[,/+] *"?gtme-grade|gtme-grade\.key|gtme_grade_key'; then
      refuse "only gtme-grade may touch a grade receipt or its key."
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
    if [ -n "$url" ]; then
      mkdir -p "$state" 2>/dev/null
      printf '%s' "$url" > "$lasturl" 2>/dev/null
    fi
    case "$tool" in
      *navigate*|*new_page*) exit 0 ;;
      *click*|*press_key*|*fill*|*type*|*evaluate*|*run_code*|*select_option*|*drag*|*hover*)
        # Any Clay page counts, not just a campaign URL: an in-app link click
        # changes the page without a navigate call, so the recorded URL can lag
        # (security review, 2026-10-05: the campaign-only match failed open).
        last="$(cat "$lasturl" 2>/dev/null || true)"
        if printf '%s' "$last" | grep -qiE 'clay\.com'; then
          launching=1
        fi
        printf '%s' "$lower" | grep -qE "$WORDS" && launching=1
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


# The playbook's five gates (tools/gtme_grade.py) must also have passed for
# exactly this action on exactly this campaign in this workspace, within 12
# hours, on inputs and live campaign state that have not changed since, in a
# receipt signed with a key only gtme-grade holds. Added 2026-10-10: the kit had
# a hundred sourced rules and a five-gate grading section, and no campaign had
# ever been graded against them. Applied to Zeutara the same day, they found
# 362 messages sent from inboxes the pre-send gate never saw.
#
# The check itself is `gtme-grade --verify`, which owns the signature, the
# binding and the re-hashing. Every way this can fail refuses: no action
# named, no campaign named, no tool, no python, a verifier error or timeout.
# No receipt is chosen by "newest": a pass for one campaign never stands in for
# another (security review, 2026-10-10).
if [ -z "$why" ]; then
  # Attribute from exactly what will run, never from a label, a description or
  # a comment beside it (security review, 2026-10-10). Only one plain Bash
  # command can be attributed: no chaining, pipes, redirection, substitution,
  # heredocs, background jobs, comments, env prefixes or wrappers, one action,
  # one campaign, at most one workspace. A browser or screen click can't show
  # what its target does, so a launch-shaped one is refused outright.
  subject=""
  attrib=""
  if [ "$tool" != "Bash" ]; then
    attrib="a click in a browser or on screen can't be tied to one action on one campaign; a person presses Start in the Clay UI."
  else
    subject="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)" ||
      attrib="the command could not be read."
    nl=$'\n'
    case "$subject" in
      *"$nl"*|*";"*|*"&"*|*"|"*|*'`'*|*'$('*|*"<"*|*">"*|*"#"*)
        attrib="the command chains, pipes, redirects, substitutes or comments, so what runs can't be attributed to one campaign." ;;
    esac
    if [ -z "$attrib" ] && printf '%s' "$subject" |
         grep -qE '^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=|env |sudo |command |exec |eval |nohup |time |xargs |bash |sh |zsh |python[0-9.]* |node )'; then
      attrib="the command runs behind an env prefix or a wrapper, so what runs can't be attributed."
    fi
    if [ -z "$attrib" ] && printf '%s' "$subject" | grep -qiE 'chewie.*\beval\b'; then
      attrib="a page script can do anything, so it can't be attributed to one action."
    fi
  fi
  slower="$(printf '%s' "$subject" | tr '[:upper:]' '[:lower:]')"
  actions=""
  printf '%s' "$slower" | grep -qE 'resume|unpause' && actions="$actions resume"
  printf '%s' "$slower" | grep -qE 'add leads|add-leads|enroll' && actions="$actions add-leads"
  printf '%s' "$slower" | grep -qE 'launch|activate|start campaign|start sending|status[ =]+active|\bstart\b' &&
    actions="$actions launch"
  nactions=$(printf '%s' "$actions" | wc -w | tr -d ' ')
  ids="$(printf '%s\n' "$subject" | grep -oE 'cam_[A-Za-z0-9]+' | sort -u)"
  nids=$(printf '%s' "$ids" | grep -c . | tr -d ' ')
  ws="$(printf '%s\n' "$subject" | grep -oE 'workspaces/[0-9]+|ws=[0-9]+|--ws[ =][0-9]+' | grep -oE '[0-9]+' | sort -u)"
  [ -n "$ws" ] || ws="${CLAY_WORKSPACE_ID:-1372623}"
  if [ -z "$attrib" ] && [ "$nactions" -gt 1 ]; then
    attrib="the command names more than one of launch, resume and add-leads."
  elif [ -z "$attrib" ] && [ "$nids" -gt 1 ]; then
    attrib="the command names more than one campaign."
  fi
  kit="${CHEWBACCA_ROOT:-}"
  if [ -z "$kit" ] && [ -f "$HOME/.chewbacca/install-manifest.json" ]; then
    kit="$(sed -n 's/.*"repo"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$HOME/.chewbacca/install-manifest.json" | head -1)"
  fi
  grader=""
  for cand in "$(dirname "${BASH_SOURCE[0]}")/../../tools/gtme_grade.py" "${kit:-$HOME/code/chewbacca}/tools/gtme_grade.py"; do
    [ -f "$cand" ] && { grader="$cand"; break; }
  done
  if [ -n "$attrib" ]; then
    why="$attrib"
  elif [ -z "$actions" ]; then
    why="cannot tell whether this is a launch, a resume or an add-leads; name the action in the command (an unlabeled click on a Clay page is refused)."
  elif [ -z "$ids" ]; then
    why="no cam_ id in the command, so no grade can be matched to it."
  elif [ "$(printf '%s\n' "$ws" | wc -l | tr -d ' ')" != "1" ]; then
    why="the command names more than one workspace."
  elif [ -z "$grader" ] || ! command -v python3 >/dev/null 2>&1; then
    why="gtme-grade or python3 is missing, so no grade can be verified."
  else
    # The verifier gets 8 of the hook's 10 seconds and is killed past that: a
    # child blocked in a read never lets the TERM trap run, and lib.sh's last
    # resort is kill -9, which the host treats as a non-blocking error.
    vout="$(mktemp "${TMPDIR:-/tmp}/launch-guard.XXXXXX")" || vout=/dev/null
    bounded() {
      local secs="$1" n=0 pid; shift
      "$@" >"$vout" 2>&1 &
      pid=$!
      while kill -0 "$pid" 2>/dev/null; do
        if [ "$n" -ge $((secs * 10)) ]; then
          kill -9 "$pid" 2>/dev/null
          echo "gtme-grade --verify did not answer within ${secs}s" >"$vout"
          return 124
        fi
        sleep 0.1
        n=$((n + 1))
      done
      wait "$pid"
    }
    for action in $actions; do
      while read -r id; do
        [ -n "$id" ] || continue
        if ! bounded 8 python3 -I "$grader" --verify --ws "$ws" --campaign "$id" --action "$action"; then
          why="$(cat "$vout" 2>/dev/null)"
          why="${why:-gtme-grade --verify failed with no message} ($action, $id)"
          break 2
        fi
      done <<< "$ids"
    done
    [ "$vout" = /dev/null ] || rm -f "$vout"
  fi
  [ -n "$why" ] && why="$why
Grade it: gtme-grade --campaign <cam_id> --action <launch|resume|add-leads> --leads <list>.csv \\
    --suppress <sent>.csv --senders <sender-accounts>.json --client <name> --review <read>.json"
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
