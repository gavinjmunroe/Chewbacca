#!/bin/bash
# The dispatch entry's fallback when ~/.local/bin/hookd is missing: every
# guard the entry names runs on every call its matcher covers, with no gate,
# and the answers fold the way `hookd dispatch` folds them (crates/hookd/src/
# dispatch.rs). Slow on purpose, never weaker: losing the binary costs the old
# CPU, not a guard. setup.sh registers it; it is not a hook on its own.
#
#     hookd-fallback.sh --guard <matcher> <timeout> <script> [--guard ...]
exec /usr/bin/python3 -I - "$@" 3<&0 <<'PY'
import json, os, re, signal, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

args = sys.argv[1:]
guards = []
while len(args) >= 4 and args[0] == "--guard":
    guards.append((args[1], int(args[2]), args[3]))
    args = args[4:]
payload = os.fdopen(3, "rb").read()
try:
    tool = json.loads(payload).get("tool_name")
except Exception:
    tool = None
PLAIN = re.compile(r"[A-Za-z0-9_-]+(\.\*)?")


def matches(matcher):
    # The host's rule (see matches() in crates/hookd/src/dispatch.rs): exact
    # names for a plain list, an unanchored regex otherwise.
    if not isinstance(tool, str) or matcher in ("", "*"):
        return True
    alts = matcher.split("|")
    if re.fullmatch(r"[A-Za-z0-9_|]+", matcher):
        return tool in alts
    if not all(PLAIN.fullmatch(a) for a in alts):
        return True
    return any((a[:-2] if a.endswith(".*") else a) in tool for a in alts)


def run(guard):
    # Its own session, so a timeout takes its children too; a guard that
    # exited keeps its code even if something it started holds the pipes.
    _, timeout, script = guard
    try:
        p = subprocess.Popen(["/bin/bash", script], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, start_new_session=True,
                             env=dict(os.environ, HOOKD_INNER="1"))
    except OSError as err:
        return 1, b"", ("hookd-fallback: could not start %s: %s\n" % (script, err)).encode()
    try:
        out, err = p.communicate(payload, timeout=timeout + 1)
        return p.returncode, out, err
    except subprocess.TimeoutExpired:
        code = p.poll()
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        if code is None:
            p.wait()
            return 1, b"", ("hookd-fallback: %s timed out\n" % script).encode()
        return code, b"", ("hookd-fallback: %s left its output open\n" % script).encode()


picked = [g for g in guards if matches(g[0])]
with ThreadPoolExecutor(max_workers=max(1, len(picked))) as pool:
    results = list(pool.map(run, picked))


def join(parts):
    out = b""
    for part in (p for p in parts if p):
        if out and not out.endswith(b"\n"):
            out += b"\n"
        out += part
    return out


JOINED = {"additionalContext", "systemMessage", "reason", "stopReason", "permissionDecisionReason"}
RANK = {"deny": 3, "ask": 2, "allow": 1}


def merge_into(into, more):
    for key, value in more.items():
        if key not in into:
            into[key] = value
        elif isinstance(into[key], dict) and isinstance(value, dict):
            merge_into(into[key], value)
        elif key in JOINED and isinstance(into[key], str) and isinstance(value, str):
            if value:
                into[key] = into[key] + "\n\n" + value if into[key] else value
        elif key == "permissionDecision" and RANK.get(value, 0) > RANK.get(into[key], 0):
            into[key] = value
        elif key == "decision" and value == "block":
            into[key] = value
        elif key == "continue" and value is False:
            into[key] = value


blocked = [r for r in results if r[0] == 2]
if blocked:
    sys.stderr.buffer.write(join(r[2] for r in blocked))
    sys.exit(2)
sys.stderr.buffer.write(join(r[2] for r in results))
answers = [r for r in results if r[0] == 0 and r[1].strip()]
failed = next((r[0] for r in results if r[0] != 0), 0)
if not answers:
    sys.exit(failed)
if len(answers) == 1:
    sys.stdout.buffer.write(answers[0][1])
    sys.exit(0)
objects = []
for r in answers:
    try:
        value = json.loads(r[1])
    except ValueError:
        continue
    if isinstance(value, dict):
        objects.append(value)
if not objects:
    sys.stdout.buffer.write(join(r[1] for r in answers))
    sys.exit(0)
merged = objects[0]
for more in objects[1:]:
    merge_into(merged, more)
sys.stdout.write(json.dumps(merged, ensure_ascii=False, separators=(",", ":")) + "\n")
sys.exit(0)
PY
