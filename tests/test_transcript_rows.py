"""Every transcript reader that collects the user's messages sees the ones he
typed mid-turn. Claude Code stores those as `"type": "attachment"` rows with a
`queued_command` inside, and on 2026-10-26 a wrap-up over the Parker Manley
session missed 41 of his ~130 messages because it read only `"type": "user"`.
The fixture is one typed prompt, one mid-turn message, and the two queued
rows that are not his words (a task notification and another session's relay)."""
from datetime import datetime, timezone
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bin" / "lib"))
sys.path.insert(0, str(ROOT / "tools"))
import transcript_rows as TR  # noqa: E402

NOW = datetime.now(timezone.utc)
TS = NOW.strftime("%Y-%m-%dT%H:%M:%S.000Z")
TYPED = "make the hero a film reel"
MID = "OOOO what if the start was the 3 2 1 countdown circle"


def load(rel):
    loader = importlib.machinery.SourceFileLoader(Path(rel).name.replace("-", "_"), str(ROOT / rel))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def queued(prompt, origin, mode="prompt"):
    return {"type": "attachment", "timestamp": TS, "uuid": f"q{len(str(prompt))}{mode}",
            "attachment": {"type": "queued_command", "prompt": prompt, "commandMode": mode, "origin": origin,
                           "humanTurn": origin.get("kind") == "human"},
            "rendered": [{"content": f"<system-reminder>The user sent a new message while you were working:\n{prompt}</system-reminder>"}]}


ROWS = [
    {"type": "user", "timestamp": TS, "message": {"role": "user", "content": TYPED}},
    {"type": "assistant", "timestamp": TS, "message": {"role": "assistant", "content": [
        {"type": "tool_use", "id": "t1", "name": "Write", "input": {"file_path": "/tmp/x/a.py", "content": "x"}}]}},
    queued(MID, {"kind": "human"}),
    queued("<task-notification>done</task-notification>", {"kind": "task-notification"}, mode="task-notification"),
    queued("Second Parker ask from Caleb, relayed", {"kind": "peer", "fromSession": "local_x"}),
    {"type": "assistant", "timestamp": TS, "message": {"role": "assistant", "content": [{"type": "text", "text": "On it."}]}},
]


class Rows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.projects = Path(cls.tmp.name) / "projects"
        (cls.projects / "-Users-x-code-site").mkdir(parents=True)
        cls.path = cls.projects / "-Users-x-code-site" / "s1.jsonl"
        cls.path.write_text("".join(json.dumps(r) + "\n" for r in ROWS))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def said(self, texts):
        texts = " | ".join(texts)
        self.assertIn(TYPED, texts)
        self.assertIn(MID, texts)
        self.assertNotIn("task-notification", texts)
        self.assertNotIn("relayed", texts)

    def test_helper(self):
        self.assertEqual(TR.as_user_row(ROWS[2])["message"]["content"], MID)
        for r in (ROWS[0], ROWS[3], ROWS[4]):
            self.assertIs(TR.as_user_row(r), r)
        blocks = queued([{"type": "text", "text": MID}, {"type": "image"}], {"kind": "human"})
        self.assertEqual(TR.human_prompt(blocks)[0]["text"], MID)

    def test_learnloop_and_recur(self):
        import learnloop
        self.said([r["said"] for r in learnloop.human_asks(days=1, roots=[self.projects])])
        recur = load("bin/recur")
        self.said([r["said"] for r in recur._parse(self.path)])

    def test_durable_check_reads_the_mid_turn_message_as_latest(self):
        text, _ = load("bin/durable-check").last_prompt(self.path)
        self.assertEqual(text, MID)

    def test_outcome_join(self):
        import outcome_join
        self.said([t for t in (outcome_join._user_text(r) for r in ROWS) if t])

    def test_steering_rate(self):
        import steering_rate
        msgs, _ = steering_rate.collect(NOW.astimezone(steering_rate.LA).strftime("%Y-%m-%d"),
                                        str(self.projects / "*" / "*.jsonl"), str(self.projects / "none" / "*.jsonl"))
        self.said([m["text"] for m in msgs])

    def test_skill_route_eval(self):
        import skill_route_eval
        self.said([t for _, t in skill_route_eval.user_texts(self.path)])

    def test_kit_debt_counts_a_mid_turn_correction(self):
        kd = load("bin/kit-debt")
        base = kd.corrections(self.path)
        p = self.path.with_name("s2.jsonl")
        p.write_text("".join(json.dumps(r) + "\n" for r in ROWS[:2] + [queued("no thats wrong, fix it", {"kind": "human"})]))
        self.assertGreater(kd.corrections(p), base)

    def test_corpus(self):
        corpus = load("bin/corpus")
        self.said([t for role, t, *_ in corpus.turns(self.path) if role == "user"])

    def test_agent_history(self):
        ah = load("bin/agent-history")
        self.said([t for e in ROWS for role, t in ah.claude_items(e) if role == "user"])

    def test_decision_inbox(self):
        import decision_inbox
        day = NOW.astimezone().strftime("%Y-%m-%d")
        self.assertEqual(decision_inbox.status_asks(self.projects, day)["messages"], 2)

    def test_break_it_reads_the_ask_without_moving_the_turn(self):
        import break_it
        ev = break_it.read_transcript(self.path)
        self.said(break_it.asks(ev))
        # the write before the mid-turn message still belongs to this turn
        self.assertTrue(any(e["kind"] == "tool" and e["name"] == "Write" for e in break_it.turn_events(ev)))

    def test_hooks_read_attachment_rows(self):
        for hook in ("reply-lessons.sh", "brain-sync.sh"):
            self.assertIn("queued_command", (ROOT / ".claude/hooks" / hook).read_text(), hook)


if __name__ == "__main__":
    unittest.main()
