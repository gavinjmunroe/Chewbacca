#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init launch-guard.sh 10
# lib.sh's watchdog ends a slow hook with exit 0, which for this hook would let
# a Clay command through whenever the check is slow (security review,
# 2026-10-10). A guard that times out refuses instead.
trap 'echo "launch-guard: timed out classifying the command, refusing" >&2; exit 2' TERM
# PreToolUse: an ALLOWLIST for anything that can reach Clay from a shell, and a
# refusal for browser or screen clicks on a Clay page.
#
# History. Written 2026-10-05 after Jonah's review found five defects in lists
# this kit had called ready; it refused launch-shaped commands without a fresh
# pre-send gate receipt. On 2026-10-10 three security reviews in a row found
# shell commands its parser read differently from the shell (quoting, $'..',
# backslashes, eval, xargs, aliases, IFS, newlines, env and exec prefixes,
# absolute paths, python -c with requests). Patching the parser was the wrong
# fix. The core moved instead:
#
#   - The only code that sends a campaign START or changes a campaign's leads is
#     `chewbacca clay` (campaign-status, add-leads). It needs a person typing
#     the op name at a terminal, and then, in code, on the request's own
#     workspace, campaign and action, a passing `gtme-grade --verify` and a full
#     pre-send gate receipt. Nothing there is parsed from text.
#   - This hook no longer guesses whether a command launches. Any Bash command
#     that mentions Clay, the sequencer or a campaign runs only if, split with
#     shlex, it is exactly a known read with no shell syntax at all. Everything
#     else that mentions Clay is refused, including curl, python, node or
#     osascript aimed at api.clay.com. What it cannot classify, it refuses.
#
# It is still a guard against an agent going around the gated path, not a
# sandbox: a script that never names Clay in its command line is not seen here,
# which is why the send path itself carries the check.

set -uo pipefail

payload="$(cat)"
MENTION='clay|sequencer|campaign'
# No jq, or a payload jq cannot parse: nothing can be classified, so anything
# that mentions Clay refuses (an unparsable payload used to fall through to 0).
blind() {
  printf '%s' "$payload" | tr -d "\"'\\\\" | tr '[:upper:]' '[:lower:]' |
    grep -qE "$MENTION|send-gate-receipt|gtme-grade" &&
    { echo "launch-guard: $1, so a command that mentions Clay can't be classified" >&2; exit 2; }
  exit 0
}
command -v jq >/dev/null 2>&1 || blind "jq is missing"
tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)" || blind "the hook payload is not JSON"
blob="$(printf '%s' "$payload" | jq -r '.tool_input // {} | tostring' 2>/dev/null)" || blind "the hook payload is not JSON"
[ -n "$blob" ] || exit 0

state="$HOME/.chewbacca/state"
lasturl="$state/launch-guard-last-url"
lower="$(printf '%s' "$blob" | tr '[:upper:]' '[:lower:]' | tr -s ' \t\n' '   ')"
WORDS='launch|resume|unpause|activate|start campaign|start sending|enroll|add leads'

refuse() {
  printf 'launch-guard: %s\n' "$1" >&2
  exit 2
}

# Shell commands: the allowlist. The classifier is plain Python (shlex), run
# isolated; if it is missing or fails, a command that mentions Clay refuses.
CLASSIFY=""
IFS= read -r -d '' CLASSIFY <<'PY' || true
import json, os, re, shlex, sys

cmd = sys.stdin.read()
kit = sys.argv[1]
MENTION = re.compile(r"clay|sequencer|campaign")


def out(verdict, why=""):
    print(f"{verdict}\t{why}")
    sys.exit(0)


# Quotes and backslashes removed, so "c\lay" and 'cl''ay' still count as Clay.
if not MENTION.search(re.sub(r"[\"'\\]", "", cmd).lower()):
    out("skip")
# No shell syntax at all: operators, substitutions, redirects, globs, escapes,
# history, comments, newlines. A quoted value can carry spaces, nothing else.
if re.search(r"[;&|`$<>(){}\[\]*?~!#\\\n\r\t\x00-\x08\x0b-\x1f\x7f]", cmd):
    out("refuse", "it uses shell syntax (operators, substitution, redirection, globs, escapes or newlines)")
try:
    argv = shlex.split(cmd, posix=True)
except ValueError:
    out("refuse", "its quoting does not parse")
if not argv:
    out("refuse", "it is empty")
# The command name must be spelled plainly, first, with nothing in front.
if not re.fullmatch(r"[a-z][a-z0-9-]*", argv[0]) or not re.match(re.escape(argv[0]) + r"(\s|$)", cmd.lstrip()):
    out("refuse", "the command name is a path, quoted, escaped or behind an env prefix")

try:
    reg = json.load(open(os.path.join(kit, "library", "clay-api", "registry.json")))
    READ_OPS = {o["name"] for o in reg["ops"] if o.get("kind") == "read"}
except (OSError, ValueError, KeyError):
    out("refuse", "the clay op registry can't be read, so no read can be confirmed")

KV = re.compile(r"[a-z_]+=[^\s]*")


def clay_read(args):
    """chewbacca clay <read-op> k=v... [--surface S] [--json]"""
    if not args:
        out("refuse", "chewbacca clay with no op")
    op, rest = args[0], args[1:]
    if op in ("ops", "doctor", "--help", "-h") and not rest:
        out("allow")
    if op in ("route", "measure"):
        if not rest or rest[0] not in READ_OPS:
            out("refuse", f"{op} names something other than a read op")
        op, rest = rest[0], rest[1:]
    if op not in READ_OPS:
        out("refuse", f"'{op}' is not a read op; writes need a person at a terminal running chewbacca clay")
    i = 0
    while i < len(rest):
        a = rest[i]
        if a == "--surface" and i + 1 < len(rest) and rest[i + 1] in ("cli", "api-anything", "bin"):
            i += 2
            continue
        if a == "--json" or KV.fullmatch(a):
            i += 1
            continue
        out("refuse", f"'{a}' is not an argument a read takes")
    out("allow")


# The clay CLI's read subcommands, as argv prefixes.
CLAY_READS = [("whoami",), ("credits", "balance"), ("campaigns", "list"), ("campaigns", "get"),
              ("campaigns", "analytics"), ("campaigns", "options"), ("tables", "list"), ("tables", "get"),
              ("tables", "columns", "get"), ("tables", "rows", "list"), ("tables", "rows", "get"),
              ("audiences", "list"), ("audiences", "get"), ("audiences", "records", "get"),
              ("audiences", "records", "search-ids"), ("workbooks", "list"), ("folders", "list"),
              ("signals", "list"), ("workflows", "list")]
LOCAL_READS = {"grep", "ls", "cat", "head", "tail", "wc", "diff", "stat"}
GIT_READS = {"status", "diff", "log", "show", "add", "commit", "ls-files", "grep", "blame"}

name, args = argv[0], argv[1:]
if name == "chewbacca":
    if not args:
        out("refuse", "chewbacca with no subcommand")
    sub, args = args[0], args[1:]
    if sub == "clay":
        clay_read(args)
    if sub in ("gtm", "gtme", "gtme-grade"):
        out("allow")
    out("refuse", f"chewbacca {sub} is not a known Clay read")
if name in ("gtm", "gtme", "gtme-grade"):
    out("allow")
if name == "clay":
    if any(tuple(args[:len(p)]) == p for p in CLAY_READS) and "--help" not in args[:1]:
        out("allow")
    out("refuse", "that clay subcommand is not a known read")
if name in LOCAL_READS:
    out("allow")
# Opening a page is a read; clicks on it are judged above, before this runs.
if name == "chewie" and args[:2] == ["web", "goto"] and len(args) == 3 and re.fullmatch(r"https://[^\s]+", args[2]):
    out("allow")
if name == "git" and args and args[0] in GIT_READS:
    out("allow")
out("refuse", f"{name} is not a known Clay read (curl, python, node, osascript and the like are never allowed near Clay)")
PY

case "$tool" in
  Bash)
    # Receipts and the grade key are written only by their own tools.
    if printf '%s' "$lower" | grep -qE 'send-gate-receipt|launch-guard-last-url'; then
      refuse "only scripts/pre_send_gate.py may write the send-gate receipt."
    fi
    if printf '%s' "$lower" | grep -qE 'state/gtme-grade|state" *[,/+] *"?gtme-grade|gtme-grade\.key|gtme_grade_key'; then
      refuse "only gtme-grade may touch a grade receipt or its key."
    fi
    cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)" ||
      refuse "the command could not be read."
    # A UI driver clicks whatever page is open, which the command line doesn't
    # show, so a launch-shaped UI action refuses whether or not it names Clay.
    if printf '%s' "$lower" | grep -qE 'chewie|jev-browse|peekaboo|mac-use|cliclick|osascript' &&
       printf '%s' "$lower" | grep -qE "$WORDS"; then
      refuse "a UI click can't be tied to one action on one campaign; a person presses Start in the Clay UI."
    fi
    # Cheap first look: a command that never mentions Clay (quotes and
    # backslashes removed) is not this hook's business.
    printf '%s' "$cmd" | tr -d "\"'\\\\" | tr '[:upper:]' '[:lower:]' | grep -qE "$MENTION" || exit 0
    kit="${CHEWBACCA_ROOT:-}"
    if [ -z "$kit" ] && [ -f "$HOME/.chewbacca/install-manifest.json" ]; then
      kit="$(sed -n 's/.*"repo"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$HOME/.chewbacca/install-manifest.json" | head -1)"
    fi
    for cand in "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)" "$kit" "$HOME/code/chewbacca"; do
      [ -n "$cand" ] && [ -f "$cand/library/clay-api/registry.json" ] && { kit="$cand"; break; }
    done
    command -v python3 >/dev/null 2>&1 || refuse "python3 is missing, so a command that mentions Clay can't be classified."
    verdict="$(printf '%s' "$cmd" | python3 -I -c "$CLASSIFY" "${kit:-/nonexistent}" 2>/dev/null)" ||
      refuse "the command classifier failed, so a command that mentions Clay is refused."
    case "$verdict" in
      allow*|skip*) exit 0 ;;
    esac
    why="${verdict#*$'\t'}"
    cat >&2 <<MSG
launch-guard: refusing a shell command that mentions Clay: ${why:-it could not be classified}.

Only exact reads run from a shell: chewbacca clay <read-op> k=v..., chewbacca gtm,
gtme, gtme-grade, or a read subcommand of the clay CLI, with no shell syntax.
Anything that writes goes through chewbacca clay, which needs a person at a
terminal; a campaign START or add-leads also needs a passing gtme-grade for that
campaign and a full pre-send gate receipt, checked in code before it sends.
MSG
    exit 2
    ;;
  mcp__peekaboo__*)
    case "$tool" in *click*|*type*|*hotkey*)
      printf '%s' "$lower" | grep -qE "$WORDS" &&
        refuse "a click on screen can't be tied to one action on one campaign; a person presses Start in the Clay UI." ;;
    esac
    exit 0
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
        # Any Clay page counts: an in-app link click changes the page without a
        # navigate call, so the recorded URL can lag (security review, 2026-10-05).
        last="$(cat "$lasturl" 2>/dev/null || true)"
        if printf '%s' "$last" | grep -qiE 'clay\.com' || printf '%s' "$lower" | grep -qE "$WORDS"; then
          refuse "a browser click on a Clay page can't be tied to one action on one campaign; a person presses Start in the Clay UI."
        fi
        ;;
    esac
    exit 0
    ;;
  *) exit 0 ;;
esac
