"""outcome_join: a skill-route row is marked right, wrong or unknown from the
skill its session actually loaded before the next prompt; rows still settling
are left alone; a second join writes nothing; calibrate picks the lowest
confidence meeting the target over enough rows, or none; floor() falls back to
the caller's default. Temp log, temp transcripts, no Jev."""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

tmp = Path(tempfile.mkdtemp())
os.environ["BOB_DECISIONS"] = str(tmp / "decisions.jsonl")
os.environ["BOB_DECISION_FLOORS"] = str(tmp / "floors.json")
os.environ["CLAUDE_CONFIG_DIR"] = str(tmp / "claude")
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
import decision_log  # noqa: E402
import outcome_join  # noqa: E402

failed = 0


def check(name, ok):
    global failed
    print(("ok   " if ok else "FAIL ") + name)
    failed += not ok


def user(text):
    return {"type": "user", "message": {"role": "user", "content": text}}


def skill(name):
    return {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Skill", "input": {"skill": name}}]}}


proj = tmp / "claude" / "projects" / "-x"
proj.mkdir(parents=True)
(proj / "s1.jsonl").write_text("\n".join(json.dumps(r) for r in [
    user("what is due this week"), skill("coursework"),
    user("who do I know at Stripe"), skill("anthropic-skills:people"),
    user("tell me a joke"),
    user("plan my week of classes"), skill("life-ops"),
]) + "\n")


def route(prompt, jev, kw="none"):
    return decision_log.record("skill-route", {"prompt": prompt, "session": "s1"},
                               {"jev": {"choice": jev, "probabilities": {jev: 0.9}},
                                "kw": {"choice": kw, "probabilities": {kw: 1.0}}}, 100)


a = route("what is due this week", "coursework")
b = route("who do I know at Stripe", "people", kw="coursework")
c = route("tell me a joke", "none")
d = route("plan my week of classes", "coursework")
counts = outcome_join.join_skill_routes(now=time.time())
check("rows younger than the settle time are left alone", counts["pending"] == 4)

later = time.time() + outcome_join.SETTLE_S + 1
counts = outcome_join.join_skill_routes(now=later)
got = {r["id"]: (r["outcome"], r["note"]) for r in decision_log.joined()}
check("Jev naming the loaded skill is right", got[a][0] == "right")
check("a plugin-prefixed load still matches", got[b][0] == "right")
check("the keyword pick is kept in the note", "kw=coursework" in got[b][1])
check("nothing loaded is unknown, not right", got[c][0] == "unknown")
check("a different loaded skill is wrong", got[d][0] == "wrong" and "loaded=life-ops" in got[d][1])
check("a second join writes nothing", sum(outcome_join.join_skill_routes(now=later).values()) == 0)

for i in range(40):
    did = decision_log.record("pick", {"i": i}, {"q": {"choice": "x", "probabilities": {"x": 0.95}}}, 1)
    decision_log.outcome(did, "right" if i < 38 else "wrong")
for i in range(40):
    did = decision_log.record("pick", {"i": i}, {"q": {"choice": "x", "probabilities": {"x": 0.55}}}, 1)
    decision_log.outcome(did, "right" if i < 20 else "wrong")
table = outcome_join.calibrate(target=0.9, min_n=30)
check("the floor is the lowest confidence meeting the target", table["pick"]["floor"] == 0.6)
check("too few labels gives no floor", table["skill-route"]["floor"] is None)
outcome_join.save_floors(table)
check("floor() reads a calibrated floor", outcome_join.floor("pick", 0.5) == 0.6)
check("floor() falls back to the caller's default", outcome_join.floor("skill-route", 0.48) == 0.48)
check("floor() falls back for an unknown decision", outcome_join.floor("nope", 0.7) == 0.7)

sys.exit(1 if failed else 0)
