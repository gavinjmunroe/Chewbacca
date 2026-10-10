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

# Caleb said in THIS session, within 2 hours, to do the Clay work himself
# (written by chat-approval.sh from his own prompt). Then a click on a Clay page
# is his instruction carried out, not an agent improvising. A launch-shaped
# click (Start, resume, enroll) also needs a fresh pre-send gate receipt whose
# lists haven't changed since it passed: a chat ok never skips the gate
# (security review of 42d642db found the first version did).
# $1 = "click" or "launch".
chat_ok() {
  python3 -I - "$1" "$state" "$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)" <<'PY' 2>/dev/null
import hashlib, json, os, sys, time
mode, state, session = sys.argv[1], sys.argv[2], sys.argv[3]
WINDOW = 2 * 3600
if not session or not all(c.isalnum() or c in "_.-" for c in session):
    sys.exit(1)
try:
    rec = json.load(open(os.path.join(state, "clay-chat-approval", session + ".json")))
    fresh = 0 <= time.time() - int(rec["at"]) < WINDOW
except Exception:
    sys.exit(1)
if not fresh or rec.get("session_id") != session:
    sys.exit(1)
if mode != "launch":
    sys.exit(0)
try:
    r = json.load(open(os.path.join(state, "send-gate-receipt.json")))
except Exception:
    sys.exit(1)
if not (0 <= time.time() - int(r.get("time", 0)) < WINDOW):
    sys.exit(1)
if not (r.get("full") or r.get("full_but_lines")):
    sys.exit(1)
hashes = r.get("hashes") or {}
if not hashes:
    sys.exit(1)
for p, h in hashes.items():
    try:
        with open(p, "rb") as f:
            if hashlib.sha256(f.read()).hexdigest() != h:
                sys.exit(1)
    except OSError:
        sys.exit(1)
sys.exit(0)
PY
}

# Shell commands: the allowlist. The classifier is plain Python (shlex), run
# isolated; if it is missing or fails, a command that mentions Clay refuses.
CLASSIFY=""
IFS= read -r -d '' CLASSIFY <<'PY' || true
import json, os, re, shlex, sys

cmd = sys.stdin.read()
kit = sys.argv[1]
cwd = sys.argv[2] if len(sys.argv) > 2 else ""
MENTION = re.compile(r"clay|sequencer|campaign")


def out(verdict, why=""):
    print(f"{verdict}\t{why}")
    sys.exit(0)


# Quotes and backslashes removed, so "c\lay" and 'cl''ay' still count as Clay.
if not MENTION.search(re.sub(r"[\"'\\]", "", cmd).lower()):
    out("skip")


def shell_syntax(s):
    """True when the shell would do anything beyond splitting words: operators,
    substitution, redirection, globbing, escapes, history, comments. Single
    quotes make their contents literal; inside double quotes $ ` \\ ! stay live."""
    if re.search(r"[\n\r\x00-\x08\x0b-\x1f\x7f]", s):
        return True
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c == "'":
            j = s.find("'", i + 1)
            if j < 0:
                return True
            i = j + 1
            continue
        if c == '"':
            j = i + 1
            while j < n and s[j] != '"':
                if s[j] in "$`\\!":
                    return True
                j += 1
            if j >= n:
                return True
            i = j + 1
            continue
        if c in ";&|`$<>(){}[]*?~!#\\":
            return True
        i += 1
    return False


if shell_syntax(cmd):
    out("refuse", "it uses shell syntax (operators, substitution, redirection, globs, escapes or newlines)")
try:
    argv = shlex.split(cmd, posix=True)
except ValueError:
    out("refuse", "its quoting does not parse")
if not argv:
    out("refuse", "it is empty")
# One env prefix is allowed, and only in front of a test runner.
no_send = False
if argv[0] == "CHEWBACCA_NO_SEND=1":
    no_send, argv = True, argv[1:]
    cmd = cmd.lstrip()[len("CHEWBACCA_NO_SEND=1"):]
    if not argv:
        out("refuse", "nothing after CHEWBACCA_NO_SEND=1")
# The command word must be spelled plainly, first: not quoted, escaped or
# assembled, and no other env prefix in front.
if "=" in argv[0] or not re.match(re.escape(argv[0]) + r"(\s|$)", cmd.lstrip()):
    out("refuse", "the command name is quoted, escaped or behind an env prefix")

try:
    reg = json.load(open(os.path.join(kit, "library", "clay-api", "registry.json")))
    READ_OPS = {o["name"] for o in reg["ops"] if o.get("kind") == "read"}
except (OSError, ValueError, KeyError):
    out("refuse", "the clay op registry can't be read, so no read can be confirmed")


def resolve(p):
    """A path as the shell will run it, from the tool call's working directory."""
    if not os.path.isabs(p):
        if not cwd or not os.path.isabs(cwd):
            return None
        p = os.path.join(cwd, p)
    return os.path.realpath(p)


def kit_file(p, rel):
    """True when p is rel inside a Chewbacca checkout (this kit, or a worktree of
    it): the file exists there, beside the Clay op registry and a git marker."""
    r = resolve(p)
    if not r or not r.endswith(os.sep + rel) or not os.path.isfile(r):
        return False
    root = r[: -len(rel) - 1]
    return (os.path.isfile(os.path.join(root, "library", "clay-api", "registry.json"))
            and os.path.exists(os.path.join(root, ".git")))


def test_runner(argv):
    name, args = argv[0], argv[1:]
    if name == "python3" and len(args) == 1 and re.fullmatch(r"tests/[A-Za-z0-9_.-]+\.py", args[0]):
        return True
    if name == "bash" and args and args[0] == "tests/run.sh" and len(args) <= 2:
        return len(args) == 1 or re.fullmatch(r"[A-Za-z0-9 ._.-]+", args[1]) is not None
    if name == "bash" and len(args) == 1 and re.fullmatch(r"tests/[A-Za-z0-9_.-]+\.sh", args[0]):
        return True
    if name == "pytest" and args and all(re.fullmatch(r"tests/[A-Za-z0-9_./:-]+|-[qxvs]+", a) for a in args):
        return True
    return False


if no_send:
    if test_runner(argv):
        out("allow")
    out("refuse", "CHEWBACCA_NO_SEND=1 is allowed only in front of a test runner")
if test_runner(argv):
    out("allow")

name, args = argv[0], argv[1:]
base = os.path.basename(name)

# The kit's own front door, in any spelling of its path. Writes there are gated
# in code (a person at a terminal, and a passing grade for a START or add-leads),
# so every op is allowed; the point is that the path is the real one.
if name in ("chewbacca-clay",) or (base == "chewbacca-clay" and kit_file(name, "bin/chewbacca-clay")):
    out("allow")
if name == "node" and args and os.path.basename(args[0]) == "chewbacca-clay" and kit_file(args[0], "bin/chewbacca-clay"):
    out("allow")
if name == "bash" and args and os.path.basename(args[0]) == "chewbacca" and kit_file(args[0], "bin/chewbacca"):
    name, args, base = "chewbacca", args[1:], "chewbacca"
if name == "chewbacca" or (base == "chewbacca" and kit_file(name, "bin/chewbacca")):
    if not args:
        out("refuse", "chewbacca with no subcommand")
    if args[0] in ("clay", "gtm", "gtme", "gtme-grade"):
        out("allow")
    out("refuse", f"chewbacca {args[0]} is not a known Clay read")
if "/" in name or not re.fullmatch(r"[a-z][a-z0-9.-]*", name):
    out("refuse", "the command is a path the kit doesn't know")

if name in ("gtm", "gtme", "gtme-grade", "code-slop", "slop-check"):
    out("allow")
if name == "python3" and args[:1] in (["tools/counts.py"], ["tools/checksums.py"]) and set(args[1:]) <= {"--check", "--json"}:
    out("allow")
if name == "python3" and args[:2] == ["-m", "json.tool"] and len(args) <= 3:
    out("allow")

# The clay CLI's read subcommands, as argv prefixes.
CLAY_READS = [("whoami",), ("credits", "balance"), ("campaigns", "list"), ("campaigns", "get"),
              ("campaigns", "analytics"), ("campaigns", "options"), ("tables", "list"), ("tables", "get"),
              ("tables", "columns", "get"), ("tables", "rows", "list"), ("tables", "rows", "get"),
              ("audiences", "list"), ("audiences", "get"), ("audiences", "records", "get"),
              ("audiences", "records", "search-ids"), ("workbooks", "list"), ("folders", "list"),
              ("signals", "list"), ("workflows", "list")]
if name == "clay":
    if any(tuple(args[:len(p)]) == p for p in CLAY_READS):
        out("allow")
    out("refuse", "that clay subcommand is not a known read")

# Read and inspect tools on local files, minus the flags that run a program.
if name in ("cat", "head", "tail", "ls", "wc", "diff", "jq", "file", "stat"):
    out("allow")
if name == "grep":
    out("allow")
if name == "rg":
    if any(a.startswith(("--pre", "-z", "--search-zip")) for a in args):
        out("refuse", "rg --pre and --search-zip run other programs")
    out("allow")
if name == "ugrep":
    if any(a.startswith(("--filter", "-z", "--decompress")) for a in args):
        out("refuse", "ugrep --filter and --decompress run other programs")
    out("allow")
if name == "find":
    if any(a in ("-exec", "-execdir", "-ok", "-okdir", "-delete") or a.startswith(("-fprint", "-fls")) for a in args):
        out("refuse", "find with -exec, -ok, -delete or -fprint changes or runs things")
    out("allow")
if name == "sed":
    # Only `sed -n <lines>p file...`: no script that writes (w) or executes (e).
    if len(args) >= 2 and args[0] == "-n" and re.fullmatch(r"[0-9]+(,[0-9]+)?p", args[1]) and \
            all(not a.startswith("-") for a in args[2:]):
        out("allow")
    out("refuse", "only sed -n <from>,<to>p <files> is allowed")

# git, any built-in subcommand except changing config, aliases or hooks.
GIT_SUBS = {"add", "am", "apply", "blame", "branch", "checkout", "cherry-pick", "commit", "describe", "diff",
            "fetch", "format-patch", "grep", "log", "ls-files", "merge", "mv", "pull", "push", "rebase", "reflog",
            "reset", "restore", "rev-parse", "revert", "rm", "shortlog", "show", "show-ref", "stash", "status",
            "switch", "tag", "worktree", "merge-base", "cat-file", "ls-tree", "rev-list", "name-rev"}
if name == "git":
    i = 0
    while i < len(args) and args[i].startswith("-"):
        if args[i] == "-C" and i + 1 < len(args):
            i += 2
            continue
        if args[i] in ("--no-pager", "--no-optional-locks"):
            i += 1
            continue
        out("refuse", f"git {args[i]} can change config or run a program")
    sub, rest = (args[i], args[i + 1:]) if i < len(args) else ("", [])
    if sub not in GIT_SUBS:
        out("refuse", f"git {sub or '(none)'} is not an allowed subcommand (config, aliases and hooks stay out)")
    if any(a in ("-x", "--exec", "-O", "--open-files-in-pager", "--ext-diff", "--upload-pack", "--receive-pack")
           or a.startswith(("--exec=", "--open-files-in-pager=", "--upload-pack=", "--receive-pack=", "--template"))
           for a in rest):
        out("refuse", "that git flag runs another program")
    out("allow")

if name == "chewie" and args[:2] == ["web", "goto"] and len(args) == 3 and re.fullmatch(r"https://\S+", args[2]):
    out("allow")
out("refuse", f"{name} is not a known Clay read (curl, wget, python -c, node -e, osascript and the like are never allowed near Clay)")
PY

case "$tool" in
  Bash)
    # Receipts and the grade key are written only by their own tools, and the
    # chat approval only by clay-chat-approval.sh from a prompt Caleb typed.
    if printf '%s' "$lower" | grep -qE 'clay-chat-approval'; then
      refuse "only Caleb's own chat message (clay-chat-approval.sh) may write the chat approval."
    fi
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
       printf '%s' "$lower" | grep -qE "$WORDS" && ! chat_ok launch; then
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
    cwd="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)"
    verdict="$(printf '%s' "$cmd" | python3 -I -c "$CLASSIFY" "${kit:-/nonexistent}" "$cwd" 2>/dev/null)" ||
      refuse "the command classifier failed, so a command that mentions Clay is refused."
    case "$verdict" in
      allow*|skip*) exit 0 ;;
    esac
    why="${verdict#*$'\t'}"
    cat >&2 <<MSG
launch-guard: refusing a shell command that mentions Clay: ${why:-it could not be classified}.

Near Clay a shell runs only known commands with no shell syntax: the kit's front
door (chewbacca clay <op>, bin/chewbacca-clay <op>, node bin/chewbacca-clay <op>),
chewbacca gtm/gtme/gtme-grade, clay CLI reads, git (not config), local read tools,
counts.py/checksums.py, code-slop, slop-check, and test runners (python3 tests/x.py,
bash tests/run.sh [group], pytest tests/...; prefix CHEWBACCA_NO_SEND=1 so nothing
sends). Writes go through chewbacca clay, which needs Caleb's ok (a terminal, or
a prompt from him in chat within 2 hours, his standing instruction); a
campaign START or add-leads also needs a passing gtme-grade and a full pre-send
gate receipt, checked in code before it sends.
MSG
    exit 2
    ;;
  mcp__peekaboo__*)
    case "$tool" in *click*|*type*|*hotkey*)
      printf '%s' "$lower" | grep -qE "$WORDS" && ! chat_ok launch &&
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
        # The last URL lags in-app navigation, so any click on Clay is treated as
        # launch-shaped when its words say so, and as a plain click otherwise.
        # Every click on Clay is launch-shaped: a click by element id carries no
        # words, and the recorded URL lags in-app navigation, so a "table page"
        # can already be a campaign page with Start one uid away (security
        # review of cccc94ea). A chat ok opens Clay clicks only beside a fresh,
        # unchanged pre-send gate pass.
        if { printf '%s' "$last" | grep -qiE 'clay\.com' || printf '%s' "$lower" | grep -qE "$WORDS"; } && ! chat_ok launch; then
          refuse "a browser click on a Clay page can't be tied to one action on one campaign; a person presses Start in the Clay UI."
        fi
        ;;
    esac
    exit 0
    ;;
  Write|Edit|MultiEdit|NotebookEdit)
    path_in="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)"
    case "$path_in" in
      *clay-chat-approval*|*send-gate-receipt*|*launch-guard-last-url*)
        refuse "approvals and receipts are written only by their own tools, never by a file edit." ;;
    esac
    exit 0
    ;;
  *) exit 0 ;;
esac
