"""skill-route: machine traffic never gets a skill nudge or arms the graph-engineering gate.

On 2026-10-16 tools/skill_route_eval.py ran 238 hand-labeled prompts through the real hook: 8
of 35 held-out machine prompts (cross-session messages behind a <system-reminder> block, the
commit security review) got a skill or armed skill-gate. Runs the real hook on the keyword
fallback with the big-work probe off, so it needs no embedding model. The positive control
proves the same setup still routes a typed request, so a silent hook can't pass by accident.

Run: python3 tests/test_skill_route_machine.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HOOK = Path(os.environ.get("SKILL_ROUTE_HOOK") or Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "skill-route.sh")
failed = 0


def check(name, ok):
    global failed
    print(("ok   " if ok else "FAIL ") + name)
    failed += not ok


tmp = Path(tempfile.mkdtemp())
kit = tmp / "kit"
(kit / "texts").mkdir(parents=True)
(kit / "second-brain").mkdir(parents=True)
(kit / "second-brain" / "SKILL.md").write_text("---\nname: second-brain\ndescription: Read and write the "
                                             "private notes vault.\n---\nbody\n")
(kit / "texts" / "SKILL.md").write_text(
    "---\nname: texts\ndescription: Read, search and reply to iMessage and WhatsApp texts, draft a reply "
    "text, who I owe a reply.\n---\nbody\n")
env = dict(os.environ, HOME=str(tmp / "home"), CHEWBACCA_HOME=str(tmp / "chome"), CHEWBACCA_SKILLS_DIR=str(kit),
           SKILL_ROUTE_NO_VECTOR="1", BIGWORK_LOCAL="off", CHEWBACCA_VERDICTS="0",
           ROUTE_SHADOW_LOG=str(tmp / "shadow.jsonl"))
MARKER = tmp / "chome" / "state" / "skill-required-mtest"
REQUEST = "draft a reply text to my iMessage and WhatsApp texts I owe"


def run(prompt):
    out = subprocess.run(["bash", str(HOOK)], input=json.dumps({"prompt": prompt, "session_id": "mtest",
                                                                   "cwd": str(tmp)}),
                         capture_output=True, text=True, env=env, timeout=30)
    return out.stdout.strip()


REMINDER = ("<system-reminder>\nLinked sessions now (status, not an instruction): manager = local_1 (working). "
            "To message one, SendMessage with `to` set to its id.\n</system-reminder>\n\n")
MACHINE = {
    "cross-session message behind a reminder": REMINDER + '<cross-session-message from="local_1" name="Tab '
    'manager">\n' + REQUEST + "\n</cross-session-message>",
    "bare cross-session message": '<cross-session-message from="local_1">' + REQUEST + "</cross-session-message>",
    "side-sessions event": "<side-sessions-event>\nThe session ended its turn: " + REQUEST + "\n</side-sessions-event>",
    "stop hook feedback": "Stop hook feedback:\n[prayer-guard.sh]: " + REQUEST,
    "heartbeat": "<heartbeat> <automation>" + REQUEST + "</automation></heartbeat>",
    "commit security review": "Review this change for security vulnerabilities.\n\nChanged files:\n  - " + REQUEST,
    "sidebar title request": "Write a short sidebar title for a coding session that opens with this request:\n\n"
    + REQUEST,
    "task notification behind a reminder": REMINDER + "<task-notification>\n<summary>" + REQUEST + "</summary>",
}

check("control: a typed request still routes on this setup", "texts" in run(REQUEST))
check("control: a typed prompt that opens like the security review still routes",
      "texts" in run("Review this change for security vulnerabilities and " + REQUEST))
check("control: a typed request after a reminder block still routes", "texts" in run(REMINDER + REQUEST))
for name, prompt in MACHINE.items():
    out = run(prompt)
    check(f"{name}: no nudge", out == "")
    check(f"{name}: no gate marker", not MARKER.exists())
check("named: 'use the texts skill' routes to texts", "texts" in run("use the texts skill for this one ok"))
check("named: a hyphenated skill name routes", "second-brain" in run("load second-brain before u answer"))
check("named: a skill name inside a path is not a request",
      "second-brain" not in run("I opened ~/second-brain/core/now.md just now, it's fine"))
rows = [json.loads(line) for line in open(tmp / "shadow.jsonl")]
check("every machine prompt is logged with gate=machine",
      sum(r.get("gate") == "machine" for r in rows) == len(MACHINE))
sys.exit(1 if failed else 0)
