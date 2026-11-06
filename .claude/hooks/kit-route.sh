#!/bin/sh
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init kit-route.sh 5
# Put the kits and projects in front of the model on every prompt, so it can
# route the work itself.
#
# The session briefing lists what kits exist, but a list read once at session
# start competes with everything else in context by the time it matters.

# The payload arrives on stdin, and the heredoc below also claims stdin, so it
# has to be read first and handed over out of band. Without this the script runs
# fine and silently never matches anything, because sys.stdin is the script.
KIT_ROUTE_PAYLOAD=$(cat)
export KIT_ROUTE_PAYLOAD

type hook_unbuffer >/dev/null 2>&1 && hook_unbuffer  # stderr goes straight to the host from here on
exec python3 -I <<'PY'
import atexit, json, os, re, subprocess, sys, time

_T0 = time.time()

def _verdict(kind, name, decision, ms=0, reason="", subject="", event="", session=""):
    """One row in ~/.chewbacca/logs/verdicts.tsv, the format tools/verdicts.py
    reads (`chewbacca why --verdicts`). Inlined in skill-route.sh and
    kit-route.sh because install.sh copies only *.sh into ~/.claude/hooks.
    Never raises."""
    try:
        if os.environ.get("CHEWBACCA_VERDICTS") == "0":
            return
        import time as _time
        path = os.environ.get("CHEWBACCA_VERDICT_LOG") or os.path.join(
            os.environ.get("CHEWBACCA_LOG_DIR") or os.path.expanduser("~/.chewbacca/logs"), "verdicts.tsv")
        def c(value, cap):
            return str(value or "").replace("\t", " ").replace("\n", " ").replace("\r", " ")[:cap]
        row = "\t".join([str(int(_time.time() * 1000)), kind, c(name, 200), c(event, 60), c(decision, 40),
                         str(int(ms or 0)), c(session or os.environ.get("CLAUDE_CODE_SESSION_ID", ""), 80),
                         c(subject, 300), c(reason, 600)]) + "\n"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(fd, row.encode("utf-8", "replace"))
        finally:
            os.close(fd)
    except Exception:
        pass


# One verdict row per prompt: the kit or project it pointed at, or none.
_ROUTED = {"decision": "skip", "reason": ""}
atexit.register(lambda: _verdict("router", "kit-route.sh", _ROUTED["decision"], (time.time() - _T0) * 1000,
                                 _ROUTED["reason"], event="UserPromptSubmit",
                                 session=str((globals().get("payload") or {}).get("session_id") or "")))

try:
    payload = json.loads(os.environ.get("KIT_ROUTE_PAYLOAD") or "{}")
except Exception:
    raise SystemExit(0)

prompt = (payload.get("prompt") or "").strip()
# A slash command is a choice the user already made.
if not prompt or prompt.startswith("/"):
    raise SystemExit(0)

# Do not re-route somebody who is already standing in a kit.
cwd = payload.get("cwd") or os.getcwd()
try:
    d = cwd
    for _ in range(4):
        if os.path.exists(os.path.join(d, ".kit")):
            raise SystemExit(0)
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
except Exception:
    pass

def kit_paths():
    for candidate in (
        os.path.expanduser("~/.local/bin/kits"),
        os.path.expanduser("~/.claude/bin/kits"),
        "kits",
    ):
        try:
            out = subprocess.run([candidate, "--paths"], capture_output=True,
                                 text=True, timeout=5)
        except (FileNotFoundError, OSError):
            continue
        if out.returncode == 0:
            return [p for p in out.stdout.split("\n") if p.strip()]
        return []
    return []

# PROJECTS ROUTE TOO, AND THEY ARE NOT KITS.
#
# A kit is a repo somebody lives inside for weeks while an agent walks them
# through a process, and kit-builder's seven-property test exists to stop
# everything becoming one. A long-running BUILD has the same discovery problem
# and none of the kit properties: a new tab needs to find lemma-replica from
# "let's finish our work on the lemma site" without being handed a path.
#
# So a .project marker, read by the same matcher, reported with its own label.
# Same fields as .kit, and `use-when` is still the only matcher input.
def project_paths():
    found, seen = [], set()
    reg = os.path.expanduser("~/.claude/projects.paths")
    try:
        with open(reg) as fh:
            for line in fh:
                d = line.strip()
                if d and d not in seen and os.path.exists(os.path.join(d, ".project")):
                    found.append(d); seen.add(d)
    except OSError:
        pass
    code = os.path.expanduser("~/code")
    # Team builds live inside the kit now (apps/), so a teammate's clone finds
    # lemma-replica wherever Chewbacca is checked out.
    kit_apps = os.path.join(os.environ.get("CHEWBACCA_ROOT") or os.path.join(code, "chewbacca"), "apps")
    for root in (kit_apps, code, *(os.path.join(code, g) for g in ("kits", "amber", "work", "school", "personal", "tools")),
                 os.path.expanduser("~/dev"), os.path.expanduser("~/Projects")):
        if not os.path.isdir(root):
            continue
        try:
            for name in os.listdir(root):
                d = os.path.join(root, name)
                if d not in seen and os.path.exists(os.path.join(d, ".project")):
                    found.append(d); seen.add(d)
        except OSError:
            pass
    return found


def read_kit(d, marker_name=".kit"):
    try:
        with open(os.path.join(d, marker_name)) as fh:
            raw = fh.read()
    except OSError:
        return None

    def field(name):
        m = re.search(rf"^{name}:\s*(.+)$", raw, re.M)
        return m.group(1).strip() if m else ""

    name = field("name")
    if field("status") == "template" or not name or "{{" in name:
        return None
    return f"{name} ({d.replace(os.path.expanduser('~'), '~')})"


# With names alone haiku went hunting the disk for "colin" (2026-11-05), so the
# path rides along. One entry per name: lemma-replica sits in two folders.
def by_name(entries):
    return sorted({e.split(" (")[0]: e for e in entries if e}.values())


kits = by_name(read_kit(d) for d in kit_paths())
projects = by_name(read_kit(d, ".project") for d in project_paths())
if not kits and not projects:
    raise SystemExit(0)

# 2026-11-05, this very hook: the stem matcher routed a sweep of Chewbacca's
# hooks into colin-kit. It had been wrong before: 25 of 28 routes in two days
# (2026-10-19) sent Firm Foundation video work there, after a year of tuning
# stems, density and rarity. Caleb, 2026-11-05: "ur an llm not an if statement".
# So nothing here reads his words. The model has the use-when lines from the
# session briefing and this note puts the names in front of it on every prompt.
named = []
if kits:
    named.append("Kits: " + ", ".join(kits) + ".")
if projects:
    named.append("Projects: " + ", ".join(projects) + ".")
_ROUTED.update(decision="note", reason=" ".join(named)[:300])
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": (
            " ".join(named) + " If what he wants done is one of these, cd there and read its CLAUDE.md or "
            "resume note before anything else. A name in passing isn't a match, judge the work. "
            "Never mention this note."
        ),
    }
}))
PY
