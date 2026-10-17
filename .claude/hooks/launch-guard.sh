#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words:
# every Bash refusal below needs a Clay mention, a receipt or grade name, or
# a UI driver. Every other tool always runs it. Proven by
# tools/hookd_replay.py: 0.113 s of CPU on every Bash call before (2026-10-12).
# gate: clay sequencer campaign send-gate-receipt launch-guard-last-url
# gate: gtme-grade gtme_grade_key chewie jev-browse peekaboo mac-use cliclick osascript
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
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
#     shlex, it is exactly a known read with no shell syntax at all, or (since
#     2026-10-11) known reads joined by ; && || | where every piece passes on
#     its own and nothing else is shell syntax. Everything
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
# v2 records come only from a prompt chat-approval.sh judged a person's; a v1
# record could be a launched session's own prompt (2026-10-10).
if not fresh or rec.get("session_id") != session or rec.get("v") != 2 or rec.get("interactive") is not True:
    sys.exit(1)
if mode != "launch":
    sys.exit(0)
# One receipt per client since 2026-10-13. A click can't be tied to a client,
# so a fresh, unchanged pass for any one client opens it, as the single shared
# receipt did before; the send path itself checks the right client's.
def intact(r):
    if not (0 <= time.time() - int(r.get("time", 0)) < WINDOW):
        return False
    if not (r.get("full") or r.get("full_but_lines")):
        return False
    hashes = r.get("hashes") or {}
    if not hashes:
        return False
    for p, h in hashes.items():
        try:
            with open(p, "rb") as f:
                if hashlib.sha256(f.read()).hexdigest() != h:
                    return False
        except OSError:
            return False
    return True
d = os.path.join(state, "send-gate-receipts")
try:
    names = sorted(n for n in os.listdir(d) if n.endswith(".json"))
except OSError:
    names = []
for n in names:
    try:
        if intact(json.load(open(os.path.join(d, n)))):
            sys.exit(0)
    except Exception:
        continue
sys.exit(1)
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
# "force" is one segment of a pipeline: it has to be a known read whether or
# not it names Clay, because `grep clay x | sh` runs Clay text in a segment
# that never mentions it.
force = len(sys.argv) > 3 and sys.argv[3] == "force"
if not force and not MENTION.search(re.sub(r"[\"'\\]", "", cmd).lower()):
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
# A write through the front door runs alone, never piped or chained, so the
# person approving it sees exactly the one command.
if force and "--allow-writes" in argv:
    out("refuse", "a Clay write runs on its own, never inside a pipeline or a chain")

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
    return real_checkout(r[: -len(rel) - 1])


GIT_ENV = {"PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", "HOME": "/nonexistent",
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"}


def git_out(*a):
    try:
        p = __import__("subprocess").run(["git", *a], capture_output=True, text=True, timeout=5, env=GIT_ENV)
    except (OSError, ValueError):
        return None
    return p.stdout.strip() if p.returncode == 0 else None


def real_checkout(root):
    """True when root is a worktree the kit's own git lists, sharing its common
    dir, with the Clay op registry in it. A registry file and a .git entry used
    to be enough, and on 2026-10-16 the Tab manager forged both in two lines
    (an empty .git dir, a {} registry) to run arbitrary code as the front door."""
    root = os.path.realpath(root)
    listed = git_out("-C", kit, "worktree", "list", "--porcelain", "-z") or ""
    trees = {os.path.realpath(rec[9:]) for rec in listed.split("\0") if rec.startswith("worktree ")}
    common = git_out("-C", kit, "rev-parse", "--path-format=absolute", "--git-common-dir")
    theirs = git_out("-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir")
    return bool(root in trees and common and theirs
                and os.path.realpath(common) == os.path.realpath(theirs)
                and os.path.isfile(os.path.join(root, "library", "clay-api", "registry.json")))


def test_runner(argv):
    name, args = argv[0], argv[1:]
    runner_cwd, runner_args = cwd, args
    if name == "node" and len(args) >= 4 and os.path.isabs(args[0]) and args[1:3] == ["run", "--root"]:
        # The Desktop bridge supplied Bash with only command + chat cwd on
        # 2026-10-15, dropping exec_command.workdir. Explicit Vitest roots
        # bind both the proposed check and execution to the same repository.
        if not os.path.isabs(args[3]):
            return False
        root = os.path.realpath(args[3])
        if args[0] != os.path.join(root, "node_modules", "vitest", "vitest.mjs"):
            return False
        runner_cwd, runner_args = root, ["node_modules/vitest/vitest.mjs", "run"] + args[4:]
    if name == "node" and runner_args[:2] == ["node_modules/vitest/vitest.mjs", "run"] and runner_cwd:
        try:
            package = json.load(open(os.path.join(runner_cwd, "node_modules", "vitest", "package.json")))
        except (OSError, ValueError):
            return False
        return (os.path.exists(os.path.join(runner_cwd, ".git")) and
                package.get("name") == "vitest" and
                os.path.isfile(os.path.join(runner_cwd, "node_modules", "vitest", "vitest.mjs")) and
                all(a == "--maxWorkers=1" or re.fullmatch(r"(?:src|tests)/[A-Za-z0-9_./-]+", a)
                    for a in runner_args[2:]))
    if name == "python3" and len(args) == 1 and re.fullmatch(r"tests/[A-Za-z0-9_.-]+\.py", args[0]):
        return True
    if name == "bash" and args and args[0] == "tests/run.sh" and len(args) <= 2:
        return len(args) == 1 or re.fullmatch(r"[A-Za-z0-9 ._.-]+", args[1]) is not None
    if name == "bash" and len(args) == 1 and re.fullmatch(r"tests/[A-Za-z0-9_.-]+\.sh", args[0]):
        return True
    if name == "pytest" and args and all(re.fullmatch(r"tests/[A-Za-z0-9_./:-]+|-[qxvs]+", a) for a in args):
        return True
    return False


# After a leading cd, a test runs only when every file it names is tracked in
# that worktree: an untracked tests/x.py there is a script, not a kit test.
after_cd = len(sys.argv) > 4 and sys.argv[4] == "cdkit"


def tracked(argv):
    files = [a.split("::")[0] for a in argv[1:] if re.match(r"(?:tests|src)/", a)]
    for f in files:
        try:
            p = __import__("subprocess").run(
                ["git", "-C", cwd, "ls-files", "--error-unmatch", "--", f], capture_output=True, timeout=5,
                env={"PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", "HOME": "/nonexistent",
                     "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"})
        except (OSError, ValueError):
            return False
        if p.returncode != 0:
            return False
    return True


def runner_ok(argv):
    return test_runner(argv) and (not after_cd or tracked(argv))


if no_send:
    if runner_ok(argv):
        out("allow")
    out("refuse", "CHEWBACCA_NO_SEND=1 is allowed only in front of a test runner")
if runner_ok(argv):
    out("allow")
if after_cd and test_runner(argv):
    out("refuse", "after a cd, a test runs only if git tracks it in that worktree")

name, args = argv[0], argv[1:]
base = os.path.basename(name)
# The 2026-10-15 Togari reviewer used Apple's Git directly after xcrun
# failed in its read-only sandbox. Permit only these host paths and reads;
# arbitrary paths, configuration overrides and executable flags stay refused.
native_git = name in ("/usr/bin/git", "/Library/Developer/CommandLineTools/usr/bin/git")
if native_git:
    name, base = "git", "git"
if name == "gh" and args[:2] == ["pr", "create"]:
    # A code PR titled with Clay was refused on 2026-10-15 as though its
    # title mutated a campaign. This exact CLI only publishes GitHub metadata;
    # publication authority remains a separate check from campaign permission.
    options = args[2:]
    allowed = {"--base", "--head", "--title", "--body-file", "--repo"}
    if (len(options) % 2 == 0 and all(options[i] in allowed for i in range(0, len(options), 2))
            and "--title" in options[::2] and "--body-file" in options[::2]):
        out("allow")
    out("refuse", "unsupported GitHub PR creation options")

# The kit's own front door, in any spelling of its path. Writes there are gated
# in code (a person at a terminal, and a passing grade for a START or add-leads),
# so every op is allowed; the point is that the path is the real one.
if name in ("chewbacca-clay",) or (base == "chewbacca-clay" and kit_file(name, "bin/chewbacca-clay")):
    out("allow")
if name == "node" and args and os.path.basename(args[0]) == "chewbacca-clay" and kit_file(args[0], "bin/chewbacca-clay"):
    out("allow")
# jev-browse on a Clay page. It was never on this list, so from the 2026-10-10
# allowlist on, every `jev-browse run --url https://app.clay.com/...` refused,
# and on 2026-10-16 no agent could sort the Sabo table before the call. Its
# floor (bin/lib/jev_browse_runner.py COMMIT) is code: a click labelled send,
# run, enrich, launch, start, resume or enroll is not executed. --allow-commit
# lifts that floor, so near Clay it stays refused.
if base == "jev-browse" and (name == "jev-browse" or kit_file(name, "bin/jev-browse")):
    if args[:1] == ["doctor"] and len(args) == 1:
        out("allow")
    if args[:1] == ["run"] and "--allow-commit" not in args:
        out("allow")
    out("refuse", "near Clay jev-browse runs only `run` without --allow-commit, or `doctor`; the person presses a send, run or launch")
if name == "bash" and args and os.path.basename(args[0]) == "chewbacca" and kit_file(args[0], "bin/chewbacca"):
    name, args, base = "chewbacca", args[1:], "chewbacca"
if name == "chewbacca" or (base == "chewbacca" and kit_file(name, "bin/chewbacca")):
    if not args:
        out("refuse", "chewbacca with no subcommand")
    if args[0] in ("clay", "gtm", "gtme", "gtme-grade"):
        out("allow")
    if args[:2] == ["jobs", "submit"]:
        # Tests still use the shared resource queue. Allow only a structured
        # build job invoking an existing kit test directly, never a shell,
        # arbitrary program, network request or nested write command.
        queued = args[2:]
        build = False
        i = 0
        while i < len(queued) and queued[i] != "--":
            if queued[i] == "--build":
                build = True
                i += 1
            elif queued[i] in ("--title", "--after", "--writes") and i + 1 < len(queued):
                i += 2
            elif queued[i] == "--once":
                i += 1
            else:
                out("refuse", "unknown queued test option")
        runner = queued[i + 1:] if i < len(queued) else []
        if runner[:2] == ["env", "CHEWBACCA_NO_SEND=1"]:
            runner = runner[2:]
        if build and runner[:1] == ["node"] and test_runner(runner):
            out("allow")
        if build and len(runner) >= 2 and runner[0] in ("python3", "bash"):
            path = resolve(runner[1])
            if path:
                root = os.path.dirname(os.path.dirname(path))
                rel = os.path.relpath(path, root)
                valid = re.fullmatch(r"tests/[A-Za-z0-9_.-]+\.(py|sh)", rel)
                checkout = real_checkout(root)
                # Tracked, as after a cd: an untracked tests/x.py is a script.
                tracked_here = checkout and git_out("-C", root, "ls-files", "--error-unmatch", "--", rel) is not None
                if valid and tracked_here and os.path.isfile(path) and test_runner([runner[0], rel, *runner[2:]]):
                    out("allow")
        out("refuse", "only direct kit test runners are allowed in queued Clay jobs")
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
    pager_disabled = False
    while i < len(args) and args[i].startswith("-"):
        if args[i] == "-C" and i + 1 < len(args):
            i += 2
            continue
        if args[i] in ("--no-pager", "--no-optional-locks"):
            if args[i] == "--no-pager":
                pager_disabled = True
            i += 1
            continue
        out("refuse", f"git {args[i]} can change config or run a program")
    sub, rest = (args[i], args[i + 1:]) if i < len(args) else ("", [])
    if sub not in GIT_SUBS:
        out("refuse", f"git {sub or '(none)'} is not an allowed subcommand (config, aliases and hooks stay out)")
    if native_git:
        if not pager_disabled:
            out("refuse", "host Git patch inspection requires global --no-pager")
        # Git accepts abbreviated executable flags and enables textconv by
        # default. The 2026-10-15 review found both escaped the denylist.
        # This exception covers only bounded patch inspection, with an exact
        # option vocabulary and both external diff mechanisms disabled.
        if sub != "show":
            out("refuse", "absolute host Git paths support only commit patch inspection")
        # After -- these strings are file names, not disabling options.
        separator = rest.index("--") if "--" in rest else len(rest)
        options = rest[:separator]
        if not {"--no-ext-diff", "--no-textconv", "--no-show-signature", "--format="}.issubset(options):
            out("refuse", "host Git patch inspection requires explicit disabling flags and an empty format")
        safe = {"--no-ext-diff", "--no-textconv", "--no-show-signature", "--no-color", "--color=never",
                "--reverse", "--oneline", "--name-only", "--name-status", "--stat",
                "--numstat", "--raw", "--summary", "--format=",
                "--patch", "-p", "--no-renames", "--check",
                "--cached", "--staged", "--"}
        if any(a.startswith("-") and a not in safe for a in options):
            out("refuse", "unsupported host Git inspection option")
    if any(a in ("-x", "--exec", "-O", "--open-files-in-pager", "--ext-diff", "--upload-pack", "--receive-pack")
           or a.startswith(("--exec=", "--open-files-in-pager=", "--upload-pack=", "--receive-pack=", "--template"))
           for a in rest):
        out("refuse", "that git flag runs another program")
    out("allow")

if name == "chewie" and args[:2] == ["web", "goto"] and len(args) == 3 and re.fullmatch(r"https://\S+", args[2]):
    out("allow")
out("refuse", f"{name} is not a known Clay read (curl, wget, python -c, node -e, osascript and the like are never allowed near Clay)")
PY

# Cuts a compound command into NUL-separated pieces at ; && || |, or prints
# nothing (the whole command goes to the classifier as one) when it holds any
# other shell syntax or has only one piece.
SPLIT=""
IFS= read -r -d '' SPLIT <<'PY' || true
import re, sys
raw = sys.stdin.read()
# Harmless redirections, removed before anything else is judged.
s = re.sub(r"(?<![^\s])(2>&1|[12]?>\s*/dev/null)(?=\s|$)", " ", raw)
stripped = s != raw
if re.search(r"[\n\r\x00-\x08\x0b-\x1f\x7f]", s):
    sys.exit(0)
parts, cur, i, n = [], [], 0, len(s)
while i < n:
    c = s[i]
    if c == "'":
        j = s.find("'", i + 1)
        if j < 0:
            sys.exit(0)
        cur.append(s[i:j + 1]); i = j + 1; continue
    if c == '"':
        j = i + 1
        while j < n and s[j] != '"':
            if s[j] in "$`\\!":
                sys.exit(0)
            j += 1
        if j >= n:
            sys.exit(0)
        cur.append(s[i:j + 1]); i = j + 1; continue
    two = s[i:i + 2]
    if two in ("&&", "||"):
        parts.append("".join(cur)); cur = []; i += 2; continue
    if c in ";|":
        parts.append("".join(cur)); cur = []; i += 1; continue
    if c in "&`$<>(){}[]*?~!#\\":
        sys.exit(0)
    cur.append(c); i += 1
parts.append("".join(cur))
parts = [p.strip() for p in parts]
if (len(parts) < 2 and not stripped) or any(not p for p in parts):
    sys.exit(0)
# One piece per line: a newline anywhere in the command already returned above,
# and bash drops NUL bytes from a command substitution.
sys.stdout.write("\n".join(parts) + "\n")
PY

# A leading `cd <absolute path> &&` into a real Chewbacca checkout (the Clay op
# registry and a git marker both there) prints the resolved directory, which
# becomes the cwd the later pieces are judged from; anything else prints
# nothing. On 2026-10-16 `cd <worktree> && python3 tests/test_chewbacca_clay.py`
# refused because cd isn't a read, and agents hid test runs in scratch scripts
# this hook never sees, which is worse than letting the cd through.
CDKIT=""
IFS= read -r -d '' CDKIT <<'PY' || true
import os, re, shlex, subprocess, sys
# A registry file and a .git entry take two lines to fake (Tab manager's attack
# on 68a6f592, 2026-10-16), so the target must be a worktree the kit's own git
# lists, sharing the kit's common dir.
kit = sys.argv[1]
ENV = {"PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", "HOME": "/nonexistent",
       "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"}


def git(*a):
    try:
        p = subprocess.run(["git", *a], capture_output=True, text=True, timeout=5, env=ENV)
    except (OSError, subprocess.SubprocessError):
        return None
    return p.stdout.strip() if p.returncode == 0 else None


m = re.match(r"\s*(cd\s+[A-Za-z0-9_./@+,:-]+)\s*&&", sys.stdin.read())
if m:
    argv = shlex.split(m.group(1))
    if len(argv) == 2 and os.path.isabs(argv[1]):
        d = os.path.realpath(argv[1])
        listed = git("-C", kit, "worktree", "list", "--porcelain", "-z") or ""
        trees = {os.path.realpath(rec[9:]) for rec in listed.split("\0") if rec.startswith("worktree ")}
        common = git("-C", kit, "rev-parse", "--path-format=absolute", "--git-common-dir")
        theirs = git("-C", d, "rev-parse", "--path-format=absolute", "--git-common-dir")
        if (d in trees and common and theirs
                and os.path.realpath(common) == os.path.realpath(theirs)
                and os.path.isfile(os.path.join(d, "library", "clay-api", "registry.json"))):
            print(d)
PY

case "$tool" in
  Bash)
    # Receipts and the grade key are written only by their own tools, and the
    # chat approval only by clay-chat-approval.sh from a prompt Caleb typed.
    if printf '%s' "$lower" | grep -qE 'clay-chat-approval'; then
      refuse "only Caleb's own chat message (clay-chat-approval.sh) may write the chat approval."
    fi
    if printf '%s' "$lower" | grep -qE 'send-gate-receipt|launch-guard-last-url'; then
      refuse "only the pre-send gate (chewbacca gtme presend) may write a send-gate receipt."
    fi
    if printf '%s' "$lower" | grep -qE 'state/gtme-grade|state" *[,/+] *"?gtme-grade|gtme-grade\.key|gtme_grade_key'; then
      refuse "only gtme-grade may touch a grade receipt or its key."
    fi
    # The standing credit allowance stands in for Caleb's ok on table writes, so
    # an agent that could edit it or its spend record could approve itself.
    if printf '%s' "$lower" | grep -qE 'clay-allowance'; then
      refuse "only chewbacca clay allowance-set (Caleb's own number) may write the credit allowance or its spend record; read it with chewbacca clay allowance."
    fi
    cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)" ||
      refuse "the command could not be read."
    # A UI driver clicks whatever page is open, which the command line doesn't
    # show, so a launch-shaped UI action refuses whether or not it names Clay.
    # Judged on the command, never the Bash description, which nothing runs:
    # on 2026-10-11 "Quit and relaunch Kyber" in a description refused a plain
    # `osascript -e 'quit app "Kyber"'`. Narrowing further (command position,
    # heredoc bodies) was tried the same night and a review reproduced seven
    # bypasses (nice, find -exec, `cat <<EOF | osascript`, ...), so the
    # substring rule stays.
    # Same normalization as $lower: a phrase split by extra spaces or a
    # newline still matches (security review of f5447e2c).
    cmdlower="$(printf '%s' "$cmd" | tr '[:upper:]' '[:lower:]' | tr -s ' \t\n' '   ')"
    if printf '%s' "$cmdlower" | grep -qE 'chewie|jev-browse|peekaboo|mac-use|cliclick|osascript' &&
       printf '%s' "$cmdlower" | grep -qE "$WORDS" && ! chat_ok launch; then
      refuse "a UI click can't be tied to one action on one campaign; start a graded draft with chewbacca clay campaign-status ws=<ws> campaign=<cam_id> status=START instead."
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
    # A read chained or piped with other reads ("grep -n x bin/chewbacca-clay |
    # head") used to refuse for its shell syntax alone, which on 2026-10-11 cost
    # an overnight session a dozen workarounds through scratch scripts the guard
    # never sees. SPLIT cuts the command at ; && || | only when nothing else in
    # it is shell syntax (no $, backticks, parentheses, braces, redirection
    # other than to /dev/null, globs or newlines), and then every piece has to
    # classify as a known read on its own, mention of Clay or not.
    segments="$(printf '%s' "$cmd" | python3 -I -c "$SPLIT" 2>/dev/null)" || segments=""
    if [ -n "$segments" ]; then
      cdkit="$(printf '%s' "$cmd" | python3 -I -c "$CDKIT" "${kit:-/nonexistent}" 2>/dev/null)" || cdkit=""
      seg_cwd="$cwd"; seg_mode=""
      # `|| [ -n "$seg" ]`: the substitution strips the last newline, and
      # without it the final piece was never read, so `grep clay x | sh` passed
      # on the grep alone (caught by tests/test_launch_guard_grade.py).
      while IFS= read -r seg || [ -n "$seg" ]; do
        if [ -n "$cdkit" ]; then
          seg_cwd="$cdkit"; seg_mode="cdkit"; cdkit=""; verdict="allow"; continue
        fi
        v="$(printf '%s' "$seg" | python3 -I -c "$CLASSIFY" "${kit:-/nonexistent}" "$seg_cwd" force "$seg_mode" 2>/dev/null)" ||
          refuse "the command classifier failed, so a command that mentions Clay is refused."
        case "$v" in
          allow*) ;;
          *) verdict="$v"; break ;;
        esac
        verdict="allow"
      done < <(printf '%s' "$segments")
    else
      verdict="$(printf '%s' "$cmd" | python3 -I -c "$CLASSIFY" "${kit:-/nonexistent}" "$cwd" 2>/dev/null)" ||
        refuse "the command classifier failed, so a command that mentions Clay is refused."
    fi
    case "$verdict" in
      allow*|skip*) exit 0 ;;
    esac
    why="${verdict#*$'\t'}"
    cat >&2 <<MSG
launch-guard: refusing a shell command that mentions Clay: ${why:-it could not be classified}.

Near Clay a shell runs only known commands, alone or joined by ; && || | with
every piece a known read, and no other shell syntax: the kit's front
door (chewbacca clay <op>, bin/chewbacca-clay <op>, node bin/chewbacca-clay <op>),
chewbacca gtm/gtme/gtme-grade, clay CLI reads, jev-browse run (no --allow-commit)
for a Clay page in the background, git (not config), local read tools,
counts.py/checksums.py, code-slop, slop-check, and test runners (python3 tests/x.py,
bash tests/run.sh [group], pytest tests/...; prefix CHEWBACCA_NO_SEND=1 so nothing
sends). Writes go through chewbacca clay, which needs Caleb's ok (a terminal, or
a prompt from him in chat within 2 hours, his standing instruction), except
row, column and run-cells writes inside the workspace's standing credit
allowance, which run with no ask (chewbacca clay allowance shows it); a
campaign START or add-leads also needs a passing gtme-grade and a full pre-send
gate receipt, checked in code before it sends.
MSG
    exit 2
    ;;
  mcp__peekaboo__*)
    case "$tool" in *click*|*type*|*hotkey*)
      printf '%s' "$lower" | grep -qE "$WORDS" && ! chat_ok launch &&
        refuse "a click on screen can't be tied to one action on one campaign; start a graded draft with chewbacca clay campaign-status ws=<ws> campaign=<cam_id> status=START instead." ;;
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
          refuse "a browser click on a Clay page can't be tied to one action on one campaign; start a graded draft with chewbacca clay campaign-status ws=<ws> campaign=<cam_id> status=START instead."
        fi
        ;;
    esac
    exit 0
    ;;
  Write|Edit|MultiEdit|NotebookEdit)
    path_in="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)"
    case "$path_in" in
      *clay-chat-approval*|*send-gate-receipt*|*launch-guard-last-url*|*clay-allowance*)
        refuse "approvals and receipts are written only by their own tools, never by a file edit." ;;
    esac
    exit 0
    ;;
  *) exit 0 ;;
esac
