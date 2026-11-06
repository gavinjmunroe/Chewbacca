#!/usr/bin/env python3
"""Replays recorded messages through .claude/hooks/plan-commit-guard.sh with the score
Jev really gave each one, from tests/fixtures/plan_commit/corpus.json. No message that
isn't a commit may get through, and the only commit it may refuse is the one on record."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / ".claude/hooks/plan-commit-guard.sh"
CORPUS = json.loads((ROOT / "tests/fixtures/plan_commit/corpus.json").read_text())["rows"]
KNOWN_MISS = {"I commit"}


def verdict(said, score):
    with tempfile.TemporaryDirectory() as t:
        plan, log = Path(t, "PLAN.md"), Path(t, "t.jsonl")
        plan.write_text("## Status\n\nDRAFT\n\n## Riskiest assumptions\n\n- x\n")
        log.write_text(json.dumps({"type": "user", "message": {"content": said}}) + "\n")
        payload = {"transcript_path": str(log), "tool_input": {
            "file_path": str(plan), "old_string": "DRAFT", "new_string": "COMMITTED, committed by Caleb, 2026-11-05"}}
        env = {k: v for k, v in os.environ.items() if k not in ("CLAUDE_CODE_SESSION_ATTENDED", "CHEWBACCA_AGENT_LAUNCHED")}
        env.update(PLAN_COMMIT_FAKE_SCORE=str(score), PLAN_COMMIT_DIR=str(Path(t, "r")))
        return subprocess.run(["bash", str(HOOK)], input=json.dumps(payload), text=True, capture_output=True, env=env).returncode


class Replay(unittest.TestCase):
    def test_nothing_that_isnt_a_commit_gets_through(self):
        for row in CORPUS:
            if row["want"] == "no":
                self.assertEqual(verdict(row["said"], row["score"]), 2, row["said"])

    def test_real_commits_pass_apart_from_the_known_miss(self):
        for row in CORPUS:
            if row["want"] == "yes" and row["said"] not in KNOWN_MISS:
                self.assertEqual(verdict(row["said"], row["score"]), 0, row["said"])

    def test_the_corpus_has_real_messages(self):
        self.assertGreaterEqual(sum(r["source"].startswith("real") for r in CORPUS), 10)


if __name__ == "__main__":
    unittest.main()
