"""skill_route_shadow: a real prompt leaves one skill-route row holding both
the Jev pick and the keyword pick; code-node prompts (short, slash, machine
traffic) leave none; a Jev failure is logged as an error, never raised. Jev is
stubbed; the log goes to a temp file."""
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ["BOB_DECISIONS"] = os.path.join(tempfile.mkdtemp(), "decisions.jsonl")
skills = Path(tempfile.mkdtemp())
for name, desc in (("coursework", "Run the user's semester: what is due, deadlines, syllabus, grades."),
                   ("people", "Remember everything about the people in the user's life and their network.")):
    (skills / name).mkdir()
    (skills / name / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {desc}\n---\nbody\n")
os.environ["CHEWBACCA_SKILLS_DIR"] = str(skills)
os.environ["CHEWBACCA_HOME"] = tempfile.mkdtemp()
os.environ["HOME"] = tempfile.mkdtemp()
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
import decision_log  # noqa: E402
import hybrid_route  # noqa: E402
import skill_route_shadow  # noqa: E402

failed = 0


def check(name, ok):
    global failed
    print(("ok   " if ok else "FAIL ") + name)
    failed += not ok


def pick(skill_name, p):
    def evaluate(payload):
        crit = payload["questions"]["skill"]["criteria"]
        sid = next((k for k, v in crit.items() if isinstance(v, dict) and v["name"] == skill_name), "none")
        return {"answers": {"skill": {"choice": sid, "probabilities": {sid: p}}}, "usage": {"input_tokens": 100}}
    return evaluate


def rows():
    return [r for r in decision_log.rows() if r.get("decision") == "skill-route"]


did = skill_route_shadow.shadow({"prompt": "what is due this week for my classes and deadlines",
                                 "session_id": "s1", "cwd": str(skills)}, evaluate=pick("coursework", 0.91))
r = rows()
check("a real prompt leaves one row", did and len(r) == 1)
check("the Jev pick is recorded", r and r[0]["answers"]["jev"] == {"choice": "coursework", "p": 0.91})
check("the keyword pick is recorded beside it", r and r[0]["answers"]["kw"]["choice"] == "coursework")

for prompt in ("hi", "/coursework due", "SYSTEM NOTIFICATION exited with code 1 for a task"):
    skill_route_shadow.shadow({"prompt": prompt}, evaluate=pick("people", 0.9))
check("short, slash and machine prompts leave no row", len(rows()) == 1)


def broken(payload):
    raise hybrid_route.jev_client().JevError("HTTP 520")


skill_route_shadow.shadow({"prompt": "who do I know at Stripe in my network"}, evaluate=broken)
r = rows()
check("a Jev failure is logged as an error row", len(r) == 2 and r[1]["error"])

sys.exit(1 if failed else 0)
