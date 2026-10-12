"""The memory indexes stop loading whole only while brain-recall holds on its
sealed set (reengineer-flat-plan step 14), and whole mode puts everything back.

Fixtures only: a temp HOME, a fake measurement, a fake `brain`. Nothing here
reads the real sealed set, the real settings or the real brain.
"""
import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import recall_gate as gate  # noqa: E402
import team_index  # noqa: E402
import agent_context  # noqa: E402

NOW = 1_800_000_000.0


def fake(r5, n=65):
    return lambda: (r5, n, {"index": "/fixture", "index_built_at": "1"})


class GateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        env = patch.dict(os.environ, {
            "HOME": str(self.home),
            "CHEWBACCA_HOME": str(self.home / ".chewbacca"),
            "CLAUDE_CONFIG_DIR": str(self.home / ".claude"),
        })
        env.start()
        self.addCleanup(env.stop)
        (self.home / ".claude").mkdir()
        self.settings = self.home / ".claude" / "settings.json"
        self.settings.write_text(json.dumps({"env": {"KEEP": "x"}, "model": "opus"}))
        (self.home / ".chewbacca").mkdir()
        self.index = self.home / ".chewbacca" / "team-memory-index.md"
        team_index.write(dst=self.index)

    # The decision

    def test_below_the_floor_loads_whole(self):
        # 2026-10-12 live: 47.7% against the 55.4% floor.
        gate.check(fake(47.7), now=NOW)
        self.assertEqual(gate.mode(now=NOW + 60), "whole")

    def test_at_the_floor_turns_recall_on(self):
        gate.check(fake(55.4), now=NOW)
        self.assertEqual(gate.mode(now=NOW + 60), "recall")

    def test_no_stamp_stale_stamp_or_pin_load_whole(self):
        self.assertEqual(gate.mode(now=NOW), "whole")
        gate.check(fake(70.0), now=NOW)
        self.assertEqual(gate.mode(now=NOW + gate.MAX_AGE_S + 1), "whole")
        self.assertEqual(gate.decide({"pass": True, "r5": 70.0, "checked_at": NOW}, "whole\n", NOW), "whole")
        # A hand-edited stamp claiming a pass under the floor still loads whole.
        self.assertEqual(gate.decide({"pass": True, "r5": 40.0, "checked_at": NOW}, None, NOW), "whole")

    def test_check_never_prints_the_sealed_questions(self):
        out = subprocess.run([sys.executable, str(ROOT / "tools/recall_gate.py"), "mode"],
                             capture_output=True, text=True, env=os.environ.copy())
        self.assertEqual(out.stdout.strip(), "whole")
        stamp = gate.check(fake(50.0), now=NOW)
        self.assertEqual(set(stamp), {"r5", "n", "floor", "pass", "checked_at", "index", "index_built_at"})

    # Applying it

    def test_recall_mode_stubs_the_index_and_turns_auto_memory_off(self):
        whole = self.index.read_text()
        gate.check(fake(60.0), now=NOW)
        mode, changed = gate.apply(now=NOW + 1)
        self.assertEqual(mode, "recall")
        stub = self.index.read_text()
        self.assertIn("brain-recall", stub)
        self.assertIn("never goes here", stub)
        self.assertLess(len(stub), len(whole) // 10)
        s = json.loads(self.settings.read_text())
        self.assertEqual(s["env"], {"KEEP": "x", gate.ENV_KEY: "1"})
        self.assertEqual(s["model"], "opus")
        self.assertEqual(json.loads(gate.mode_path().read_text())["mode"], "recall")

    def test_whole_mode_puts_everything_back(self):
        whole = self.index.read_text()
        gate.check(fake(60.0), now=NOW)
        gate.apply(now=NOW + 1)
        gate.check(fake(47.7), now=NOW + 2)
        mode, _ = gate.apply(now=NOW + 3)
        self.assertEqual(mode, "whole")
        self.assertEqual(self.index.read_text(), whole)
        self.assertEqual(json.loads(self.settings.read_text())["env"], {"KEEP": "x"})

    def test_whole_mode_leaves_a_hand_set_env_alone(self):
        self.settings.write_text(json.dumps({"env": {gate.ENV_KEY: "1"}}))
        gate.apply(now=NOW)
        self.assertEqual(json.loads(self.settings.read_text())["env"], {gate.ENV_KEY: "1"})

    def test_apply_with_no_team_index_writes_none(self):
        self.index.unlink()
        gate.check(fake(60.0), now=NOW)
        gate.apply(now=NOW + 1)
        self.assertFalse(self.index.exists())

    def test_startup_block_drops_memory_index_only_in_recall(self):
        brain = self.home / "brain"
        (brain / "core").mkdir(parents=True)
        agent_context.install_claude(brain, mode="whole")
        claude_md = self.home / ".claude" / "CLAUDE.md"
        self.assertIn("memory/MEMORY.md", claude_md.read_text())
        (self.home / ".chewbacca" / "context.json").write_text(json.dumps({"brain_dir": str(brain)}))
        gate.check(fake(60.0), now=NOW)
        gate.apply(now=NOW + 1)
        self.assertNotIn("memory/MEMORY.md", claude_md.read_text())
        self.assertIn("core/voice.md", claude_md.read_text())
        gate.check(fake(40.0), now=NOW + 2)
        gate.apply(now=NOW + 3)
        self.assertIn("memory/MEMORY.md", claude_md.read_text())

    def test_whole_mode_restores_a_block_setup_wrote_in_recall(self):
        for layout in ("core", "flat"):
            brain = self.home / ("brain-" + layout)
            if layout == "core":
                (brain / "core").mkdir(parents=True)
            else:
                brain.mkdir()
                (brain / "YOU.md").write_text("me")
            agent_context.install_claude(brain, mode="whole")
            claude_md = self.home / ".claude" / "CLAUDE.md"
            original = claude_md.read_text()
            agent_context.install_claude(brain, mode="recall")
            self.assertNotIn("memory/MEMORY.md", claude_md.read_text())
            gate.apply(now=NOW)
            self.assertEqual(claude_md.read_text(), original, layout)

    def test_apply_keeps_the_script_path_and_src_it_was_given(self):
        brain = self.home / "brain"
        (brain / "core").mkdir(parents=True)
        agent_context.install_claude(brain, mode="whole")
        claude_md = self.home / ".claude" / "CLAUDE.md"
        path_line = [l for l in claude_md.read_text().splitlines() if "agent_context.py" in l]
        src = self.home / "checkout" / "team" / "memory" / "MEMORY.md"
        src.parent.mkdir(parents=True)
        src.write_text((ROOT / "team/memory/MEMORY.md").read_text())
        team_index.write(src=src, dst=self.index)
        before = self.index.read_text()
        gate.apply(now=NOW, src=src)
        self.assertEqual(self.index.read_text(), before)
        gate.check(fake(60.0), now=NOW)
        gate.apply(now=NOW + 1, src=src)
        self.assertIn(str(src), self.index.read_text())
        self.assertEqual([l for l in claude_md.read_text().splitlines() if "agent_context.py" in l], path_line)

    # Who reads the mode

    def test_brain_recall_asks_for_five_only_in_recall(self):
        bindir = self.home / "bin"
        bindir.mkdir()
        log = self.home / "argv"
        (bindir / "brain").write_text(f'#!/bin/sh\necho "$@" > "{log}"\necho "# brain mode=hybrid"\n')
        (bindir / "brain").chmod(0o755)
        env = dict(os.environ, PATH=f"{bindir}:/usr/bin:/bin", ROUTE_SHADOW_LOG=str(self.home / "shadow.jsonl"))

        def k():
            subprocess.run(["bash", str(ROOT / ".claude/hooks/brain-recall.sh")], env=env, text=True,
                           input=json.dumps({"prompt": "what did my mentor say about loneliness"}),
                           capture_output=True)
            argv = log.read_text().split()
            return argv[argv.index("--k") + 1]

        self.assertEqual(k(), "3")
        gate.check(fake(60.0), now=time.time())
        gate.apply()
        self.assertEqual(k(), "5")

    def test_context_budget_auto_cap_follows_the_mode(self):
        path = ROOT / "bin" / "context-budget"
        loader = importlib.machinery.SourceFileLoader("context_budget_rg", str(path))
        spec = importlib.util.spec_from_loader("context_budget_rg", loader)
        cb = importlib.util.module_from_spec(spec)
        loader.exec_module(cb)
        self.assertEqual(cb.auto_cap(), 131_426)
        gate.check(fake(60.0), now=time.time())
        self.assertEqual(cb.auto_cap(), 131_426 - 16_304)
        self.assertEqual(cb.cap_arg("auto"), "auto")
        self.assertEqual(cb.cap_arg("1000"), 1000)


if __name__ == "__main__":
    unittest.main(verbosity=1)
