#!/usr/bin/env python3
"""Reengineer step 16: no guard, router or classifier lands without its
replay or sealed eval.

tools/decision_evals.py finds every guard, router and classifier, and
`verify` fails on one that has neither a `# gate:` header (the hookd replay),
a registered replay, a sealed eval, nor a place on the frozen grandfathered
list. On main before this, nothing refused: a new refusing hook with no eval
landed silently, which is how 38 of 39 landed in the two weeks before.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "decision_evals.py"
sys.path.insert(0, str(ROOT / "tools"))
import decision_evals as de  # noqa: E402

GUARD = "#!/bin/bash\n# refuses foo\nread -r p\necho no >&2\nexit 2\n"


def git(root, *args):
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True,
                   env=dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                            GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t"))


class Repo:
    """A tiny kit: one gated guard, one grandfathered router, a runner."""

    def __init__(self):
        self.root = Path(tempfile.mkdtemp())
        git(self.root, "init", "-q", "-b", "main")
        self.write(".claude/hooks/old-guard.sh", "#!/bin/bash\n# gate: rm\nexit 0\n")
        self.write(".claude/hooks/lib.sh", "exit 2\n")
        self.write("tools/old_route.py", "print('route')\n")
        self.write("tests/run.sh", "#!/bin/bash\n")
        self.registry({"components": {}, "evals": {}, "grandfathered": ["tools/old_route.py"]})
        self.commit()

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        git(self.root, "add", rel)

    def registry(self, reg):
        self.write(de.REGISTRY_REL, json.dumps(reg))

    def reg(self):
        return json.loads((self.root / de.REGISTRY_REL).read_text())

    def commit(self):
        git(self.root, "commit", "-q", "-m", "x", "--allow-empty")

    def verify(self, *extra):
        p = subprocess.run([sys.executable, str(TOOL), "verify", "--root", str(self.root), *extra],
                           capture_output=True, text=True, timeout=60)
        return p.returncode, p.stderr


class DecisionEvals(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()

    def tearDown(self):
        shutil.rmtree(self.repo.root, ignore_errors=True)

    def test_the_real_kit_verifies(self):
        p = subprocess.run([sys.executable, str(TOOL), "verify"], capture_output=True, text=True, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_a_clean_tree_passes(self):
        rc, err = self.repo.verify()
        self.assertEqual(rc, 0, err)

    def test_a_new_guard_with_no_eval_fails(self):
        self.repo.write(".claude/hooks/new-guard.sh", GUARD)
        rc, err = self.repo.verify()
        self.assertEqual(rc, 1)
        self.assertIn(".claude/hooks/new-guard.sh: a new guard", err)

    def test_a_refusing_hook_is_a_guard_whatever_its_name(self):
        self.repo.write(".claude/hooks/tabs-helper.sh", GUARD)
        self.repo.write(".claude/hooks/test-ish.sh", GUARD)
        rc, err = self.repo.verify()
        self.assertEqual(rc, 1)
        self.assertIn("tabs-helper.sh: a new guard", err)
        self.assertIn("test-ish.sh: a new guard", err)

    def test_a_gate_header_is_its_replay(self):
        self.repo.write(".claude/hooks/new-guard.sh", "#!/bin/bash\n# gate: foo\n" + GUARD)
        rc, err = self.repo.verify()
        self.assertEqual(rc, 0, err)

    def test_a_new_router_or_classifier_with_no_eval_fails(self):
        self.repo.write("bin/lib/mail_router.py", "x = 1\n")
        self.repo.write("tools/lead_score.py", "x = 1\n")
        rc, err = self.repo.verify()
        self.assertEqual(rc, 1)
        self.assertIn("bin/lib/mail_router.py: a new router", err)
        self.assertIn("tools/lead_score.py: a new classifier", err)

    def test_a_replay_must_name_its_corpus_and_be_wired(self):
        self.repo.write("tools/mail_route.py", "x = 1\n")
        self.repo.write("tests/fixtures/mail/real.jsonl", '{"a": 1}\n')
        self.repo.write("tests/test_mail_route.py", "import mail_route\n")
        reg = self.repo.reg()
        reg["evals"]["tools/mail_route.py"] = {"type": "replay", "test": "tests/test_mail_route.py",
                                               "corpus": "tests/fixtures/mail/real.jsonl"}
        self.repo.registry(reg)
        rc, err = self.repo.verify()
        self.assertEqual(rc, 1)
        self.assertIn("never reads its corpus", err)
        self.assertIn("is not run by tests/run.sh or pre-push", err)
        self.repo.write("tests/test_mail_route.py", "import mail_route\nopen('tests/fixtures/mail/real.jsonl')\n")
        self.repo.write("tests/run.sh", "#!/bin/bash\npython3 tests/test_mail_route.py\n")
        rc, err = self.repo.verify()
        self.assertEqual(rc, 0, err)

    def test_an_empty_corpus_is_no_replay(self):
        self.repo.write("tools/mail_route.py", "x = 1\n")
        self.repo.write("tests/fixtures/mail/real.jsonl", "")
        self.repo.write("tests/test_mail_route.py", "mail_route real.jsonl\n")
        self.repo.write("tests/run.sh", "tests/test_mail_route.py\n")
        reg = self.repo.reg()
        reg["evals"]["tools/mail_route.py"] = {"type": "replay", "test": "tests/test_mail_route.py",
                                               "corpus": "tests/fixtures/mail/real.jsonl"}
        self.repo.registry(reg)
        rc, err = self.repo.verify()
        self.assertEqual(rc, 1)
        self.assertIn("missing or empty", err)

    def test_a_sealed_eval_needs_a_set_and_a_floor(self):
        self.repo.write("tools/mail_route.py", "x = 1\n")
        self.repo.write("tools/mail_route_check.py", "# scores mail_route on the sealed set\n")
        reg = self.repo.reg()
        reg["evals"]["tools/mail_route.py"] = {"type": "sealed", "script": "tools/mail_route_check.py",
                                               "set": "~/.chewbacca/evals/mail"}
        self.repo.registry(reg)
        rc, err = self.repo.verify()
        self.assertEqual(rc, 1)
        self.assertIn("names no floor", err)
        reg["evals"]["tools/mail_route.py"]["floor"] = "accuracy 0.9"
        self.repo.registry(reg)
        rc, err = self.repo.verify()
        self.assertEqual(rc, 0, err)

    def test_the_grandfathered_list_only_shrinks_against_the_base(self):
        self.repo.write("tools/new_route.py", "x = 1\n")
        reg = self.repo.reg()
        reg["grandfathered"].append("tools/new_route.py")
        self.repo.registry(reg)
        rc, err = self.repo.verify()
        self.assertEqual(rc, 0, err)  # with no base to compare, the list is trusted
        rc, err = self.repo.verify("--base", "HEAD")
        self.assertEqual(rc, 1)
        self.assertIn("tools/new_route.py: grandfathered here but not on the base", err)

    def test_a_grandfathered_name_that_gains_an_eval_comes_off(self):
        self.repo.write(".claude/hooks/older-guard.sh", GUARD)
        reg = self.repo.reg()
        reg["grandfathered"].append(".claude/hooks/older-guard.sh")
        self.repo.registry(reg)
        self.assertEqual(self.repo.verify()[0], 0)
        self.repo.write(".claude/hooks/older-guard.sh", "#!/bin/bash\n# gate: foo\n" + GUARD)
        rc, err = self.repo.verify()
        self.assertEqual(rc, 1)
        self.assertIn("take it off grandfathered", err)

    def test_an_eval_for_a_file_that_is_gone_fails(self):
        reg = self.repo.reg()
        reg["evals"]["tools/gone_route.py"] = {"type": "sealed", "script": "x", "set": "~/x", "floor": "1"}
        self.repo.registry(reg)
        rc, err = self.repo.verify()
        self.assertEqual(rc, 1)
        self.assertIn("listed under evals but gone", err)

    def test_every_refusal_spelling_makes_a_guard(self):
        # Review of 812b84a1: kit-debt.sh, hookd-fallback.sh and write-log.sh
        # refuse with these and were missed by the first regex.
        self.repo.write(".claude/hooks/a.sh", "jq -n '{decision: \"block\", reason: $r}'\n")
        self.repo.write(".claude/hooks/b.sh", "python3 - <<'PY'\nimport sys\nsys.exit(2)\nPY\n")
        self.repo.write(".claude/hooks/c.sh", "tool \"$@\"\nexit $?\n")
        self.repo.write(".claude/hooks/d.py", "import sys\nsys.exit( 2 )\n")
        self.repo.write(".claude/hooks/e.sh", 'echo \'{"permissionDecision": "deny"}\'\n')
        rc, err = self.repo.verify()
        self.assertEqual(rc, 1)
        for name in ("a.sh", "b.sh", "c.sh", "d.py", "e.sh"):
            self.assertIn(f".claude/hooks/{name}: a new guard", err)

    def test_a_comment_about_exit_2_is_not_a_guard(self):
        self.repo.write(".claude/hooks/notes.sh", "#!/bin/bash\n# never exit 2 here\nexit 0\n")
        self.repo.write("tools/scoreboard.py", "x = 1\n")
        rc, err = self.repo.verify()
        self.assertEqual(rc, 0, err)

    def test_a_gate_file_header_is_replayed_too(self):
        # hookd_replay.gated_hooks replays `# gate-file:` guards (skill-gate.sh).
        self.repo.write(".claude/hooks/new-gate.sh", "#!/bin/bash\n# gate-file: x\n" + GUARD)
        rc, err = self.repo.verify()
        self.assertEqual(rc, 0, err)

    def test_a_component_cannot_be_its_own_eval(self):
        self.repo.write("tools/mail_router.py", "x = 1\n")
        reg = self.repo.reg()
        reg["evals"]["tools/mail_router.py"] = {"type": "sealed", "script": "tools/mail_router.py",
                                                "set": "~/x", "floor": "x"}
        self.repo.registry(reg)
        rc, err = self.repo.verify()
        self.assertEqual(rc, 1)
        self.assertIn("names itself as its own eval", err)

    def test_a_hand_listed_classifier_cannot_drop_off_against_the_base(self):
        self.repo.write("tools/reply_kind.py", "def classify(x): pass\n")
        self.repo.write("tools/reply_kind_check.py", "reply_kind\n")
        reg = self.repo.reg()
        reg["components"]["tools/reply_kind.py"] = "classifier"
        reg["evals"]["tools/reply_kind.py"] = {"type": "sealed", "script": "tools/reply_kind_check.py",
                                               "set": "~/x", "floor": "acc 0.9"}
        self.repo.registry(reg)
        self.repo.commit()
        reg["components"], reg["evals"] = {}, {}
        self.repo.registry(reg)
        rc, err = self.repo.verify("--base", "HEAD")
        self.assertEqual(rc, 1)
        self.assertIn("tools/reply_kind.py: listed under components on the base, dropped here", err)

    def test_the_hud_lane_is_not_read(self):
        self.repo.write("hud/scripts/voice_router.py", "x = 1\n")
        self.repo.write("bin/lib/realm_ui/route.py", "x = 1\n")
        rc, err = self.repo.verify()
        self.assertEqual(rc, 0, err)

    def test_pre_push_runs_it_against_main(self):
        text = (ROOT / ".githooks" / "pre-push").read_text()
        self.assertIn("tools/decision_evals.py verify --base", text)

    def test_the_suite_runs_it(self):
        self.assertIn("tests/test_decision_evals.py", (ROOT / "tests" / "run.sh").read_text())


if __name__ == "__main__":
    unittest.main()
