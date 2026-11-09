"""Replay 2026-10-16's blockquoted replies through .claude/hooks/draft-source-guard.sh.

Corpus: tests/fixtures/steering/draft_replies_2026_10_16.json, every Claude
Code reply that day (to 5:30pm PT) holding a blockquote, redacted.

That day the only drafts Caleb pushed back on for their numbers were the
Zeutara weekly texts in session 2bb3894f ("Wait is 1% actually the bar where
did u get that"). The guard has to stop those and stay quiet everywhere else.
"""
import json
import os
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, "tests", "fixtures", "steering", "draft_replies_2026_10_16.json")
HOOK = os.path.join(ROOT, ".claude", "hooks", "draft-source-guard.sh")


def fires(reply):
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "CHEWBACCA_LOG_DIR": tempfile.gettempdir()}
    p = subprocess.run(["bash", HOOK], input=json.dumps({"last_assistant_message": reply}),
                       capture_output=True, text=True, env=env, timeout=30)
    return p.returncode == 2


def test_replay():
    replies = json.load(open(CORPUS))["replies"]
    got = [(r["session"], r["time"]) for r in replies if fires(r["reply"])]
    # The draft he questioned (2:01pm) and the one the agent's own reread later
    # found three bad lines in (2:09pm).
    assert ("2bb3894f", "21:01Z") in got and ("2bb3894f", "21:09Z") in got, got
    assert all(s == "2bb3894f" for s, _ in got), got
    # Measured when it landed: 10 of 15 blockquoted replies, all in that window.
    assert len(got) <= 10, got


if __name__ == "__main__":
    test_replay()
    print("draft-source-guard replay: all passed")
