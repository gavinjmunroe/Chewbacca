"""skill-route: learned trigger phrases route texting-register prompts, as whole words only.

Backlog 3, 2026-10-31: the keyword router matched documentation-English descriptions, so a
prompt like "give me a text to send the gc" got nothing. config/skill-route-phrases.json holds
phrases learned from the train split (tools/skill_route_phrases.py); on the held-out split it
took precision from 13.2% to 17.9% and recall from 19.7% to 26.8% with typed false fires
unchanged. This runs the real hook on the keyword path with a fixture catalog, plus a control
with the phrases off, so a hook that routes on descriptions alone can't pass.

Run: python3 tests/test_skill_route_phrases.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = Path(os.environ.get("SKILL_ROUTE_HOOK") or ROOT / ".claude" / "hooks" / "skill-route.sh")
sys.path.insert(0, str(ROOT / "tools"))
import skill_route_phrases  # noqa: E402

failed = 0


def check(name, ok):
    global failed
    print(("ok   " if ok else "FAIL ") + name)
    failed += not ok


tmp = Path(tempfile.mkdtemp())
kit = tmp / "kit"
(kit / "texts").mkdir(parents=True)
# The description shares no word with the prompts below, so only a phrase can route them.
(kit / "texts" / "SKILL.md").write_text("---\nname: texts\ndescription: Read and answer iMessage and "
                                        "WhatsApp threads.\n---\nbody\n")
env = dict(os.environ, HOME=str(tmp / "home"), CHEWBACCA_HOME=str(tmp / "chome"), CHEWBACCA_SKILLS_DIR=str(kit),
           SKILL_ROUTE_NO_VECTOR="1", BIGWORK_LOCAL="off", CHEWBACCA_VERDICTS="0",
           ROUTE_SHADOW_LOG=str(tmp / "shadow.jsonl"))


def run(prompt, **extra):
    out = subprocess.run(["bash", str(HOOK)], input=json.dumps({"prompt": prompt, "session_id": "ptest",
                                                                   "cwd": str(tmp)}),
                         capture_output=True, text=True, env=dict(env, **extra), timeout=30)
    return out.stdout.strip()


table = json.loads((ROOT / "config" / "skill-route-phrases.json").read_text())["phrases"]
check("the shipped table names texts with 'text to send'", "text to send" in table.get("texts", []))
check("every phrase is lowercase words the matcher can see",
      all(isinstance(p, str) and p == " ".join(skill_route_phrases.words(p)) for ps in table.values() for p in ps))

out = run("Ok j give me a text to send in the gc")
check("a texting-register prompt routes to texts", "texts" in out)
check("the nudge says which phrase matched", 'phrase \\"text to send\\"' in out)
check("control: with phrases off the same prompt is silent", run("Ok j give me a text to send in the gc",
                                                                   SKILL_ROUTE_PHRASES="off") == "")
check("a phrase inside a longer word does not match", run("the pretexts were fine, ship it") == "")
check("a phrase for a skill not installed is skipped", run("ok launch the campaigns") == "")
check("a phrase inside a path does not match", run("open notes/texts/today.md and fix the typo") == "")
check("machine traffic stays silent even with a phrase",
      run('<cross-session-message from="local_1">give me a text to send the gc</cross-session-message>') == "")

# The learner reads the train split only: a phrase that appears only in held rows is never learned.
rows = ([{"split": "train", "kind": "typed", "label": "texts", "text": f"write a reply text now {i}"} for i in range(3)]
        + [{"split": "held", "kind": "typed", "label": "coursework", "text": f"what is due tmr {i}"} for i in range(5)]
        + [{"split": "train", "kind": "typed", "label": "NONE", "text": f"write some code {i}"} for i in range(2)])
found = skill_route_phrases.learn(rows, 2, 0.75)
check("learner finds the train phrase", any(g == "reply text" or g == "reply" for g, _s, _p in found.get("texts", [])))
check("learner never reads the held split", "coursework" not in found)
check("learner drops a phrase a NONE row shares", all(g != "write" for g, _s, _p in found.get("texts", [])))
brief = [{"split": "train", "kind": "brief", "label": "texts", "text": "boilerplate about sessions"}] * 3
check("learner skips briefs by default", skill_route_phrases.learn(brief, 2, 0.75) == {})
sys.exit(1 if failed else 0)
