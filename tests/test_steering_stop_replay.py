"""Replay 2026-10-16's real closing turns through the three steering Stop hooks.

Corpora (tests/fixtures/steering/):
  closing_turns_2026_10_16.json  every turn Caleb answered that day, redacted,
                                 with the label of his next message
  land_events_2026_10_16.json    the tool events behind each of those turns

Components replayed: .claude/hooks/open-work-guard.sh,
.claude/hooks/blocked-route-guard.sh, .claude/hooks/learn-on-land.sh.

A hook is worth its refusals only when the turns it stops are the ones he had
to push. So each one has to catch the named real cases, and most of what it
fires on has to be a turn he answered with steering or a status poll.
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, "tests", "fixtures", "steering")
HOOKS = os.path.join(ROOT, ".claude", "hooks")


def run(hook, payload):
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "CHEWBACCA_LOG_DIR": tempfile.gettempdir()}
    p = subprocess.run(["bash", os.path.join(HOOKS, hook)], input=json.dumps(payload),
                       capture_output=True, text=True, env=env, timeout=30)
    return p.returncode == 2


def pushed(label):
    return label.startswith("steer:") or label == "poll"


def closing_turns(tmp):
    data = json.load(open(os.path.join(FIX, "closing_turns_2026_10_16.json")))["turns"]
    for n, t in enumerate(data):
        path = os.path.join(tmp, f"t{n}.jsonl")
        with open(path, "w") as fh:
            fh.write(json.dumps({"type": "user", "message": {"role": "user", "content": "go"}}) + "\n")
            if t["recap"] or t["ask"]:
                fh.write(json.dumps({"type": "assistant", "message": {"content": [
                    {"type": "tool_use", "name": "mcp__ccd_turn__wrap_up",
                     "input": {"recap": t["recap"], "ask": t["ask"]}}]}}) + "\n")
        yield t, {"last_assistant_message": t["reply"], "transcript_path": path}


def land_transcript(tmp, n, events, turn_start):
    rows = [{"type": "user", "message": {"role": "user", "content": "start"}}]
    tools = {"M": ("Edit", {"file_path": "/r/team/memory/feedback_x.md"}),
             "C": ("Edit", {"file_path": "/r/tools/x.py"}),
             "L": ("Bash", {"command": "chewbacca land --paths tools/x.py -m x"})}
    for i, e in enumerate(events):
        if i == turn_start and i:
            rows.append({"type": "user", "message": {"role": "user", "content": "next"}})
        name, inp = tools[e]
        rows.append({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": name, "input": inp}]}})
    if turn_start >= len(events) and events:
        rows.append({"type": "user", "message": {"role": "user", "content": "next"}})
    path = os.path.join(tmp, f"l{n}.jsonl")
    with open(path, "w") as fh:
        fh.writelines(json.dumps(r) + "\n" for r in rows)
    return path


def test_open_work_and_blocked_route_on_the_real_day():
    with tempfile.TemporaryDirectory() as tmp:
        fired = {"open-work-guard.sh": [], "blocked-route-guard.sh": []}
        total = 0
        for t, payload in closing_turns(tmp):
            total += 1
            for hook in fired:
                if run(hook, payload):
                    fired[hook].append(t)
    ow, br = fired["open-work-guard.sh"], fired["blocked-route-guard.sh"]
    caught = {(t["session"], t["time"]) for t in ow}
    # The two "Are you done with your work?" turns, and f7901545's "Want me
    # to verify ...?" offer that he answered "Yes, verify ...".
    for case in [("2bb3894f", "14:49"), ("faf1c561", "14:49"), ("f7901545", "14:49")]:
        assert case in caught, (case, sorted(caught))
    # Measured when it landed: fired on 13 of 160 turns, 8 answered with a
    # push or a poll, and 2 of the other 5 were its own offers he then took
    # (14:16, 14:48). Past these bounds it nags more than he did.
    assert len(ow) <= 0.15 * total, (len(ow), total)
    assert sum(pushed(t["next_label"]) for t in ow) >= 0.55 * len(ow), [t["next_label"] for t in ow]
    br_caught = {(t["session"], t["time"]) for t in br}
    assert ("faf1c561", "12:35") in br_caught and ("faf1c561", "12:42") in br_caught, br_caught
    # It fired on 3 turns that day, all in the demo tab before 12:44.
    assert len(br) <= 4, [(t["session"], t["time"]) for t in br]


def test_learn_on_land_on_the_real_day():
    data = json.load(open(os.path.join(FIX, "land_events_2026_10_16.json")))["turns"]
    fired, asked, asked_caught = [], 0, 0
    with tempfile.TemporaryDirectory() as tmp:
        for n, t in enumerate(data):
            path = land_transcript(tmp, n, t["events"], t["turn_start"])
            hit = run("learn-on-land.sh", {"last_assistant_message": "Landed.", "transcript_path": path})
            if hit:
                fired.append(t)
            if t["next_label"] == "steer:learn_ritual":
                asked += 1
                asked_caught += hit
    # Measured when it landed: fired on 13 of 166 turns and caught 5 of the
    # 25 asks. It fires only where the turn itself landed, so an ask after a
    # quiet turn is out of its reach.
    assert asked_caught >= 4, (asked_caught, asked)
    assert len(fired) <= 0.2 * len(data), (len(fired), len(data))


if __name__ == "__main__":
    test_open_work_and_blocked_route_on_the_real_day()
    test_learn_on_land_on_the_real_day()
    print("steering stop replay: all passed")
