#!/usr/bin/env python3
"""Reengineer step 15: prose rules that became checks.

attribution-guard and .githooks/commit-msg refuse AI attribution, commit-msg
refuses a code fix with no test, artifact-guard refuses publishing an
Artifact, chewbacca land --paths runs commit-msg, and tools/rule_checks.py
keeps the share of rules with a check from dropping. Each test fails on main,
where none of these files exist.
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
HOOKS = ROOT / ".claude" / "hooks"
COMMIT_MSG = ROOT / ".githooks" / "commit-msg"
sys.path.insert(0, str(ROOT / "tools"))
import rule_checks  # noqa: E402

TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"


def hook(name, payload, env=None):
    e = dict(os.environ, HOOKD_INNER="1", CHEWBACCA_HOME=tempfile.mkdtemp())
    e.update(env or {})
    p = subprocess.run(["bash", str(HOOKS / name)], input=json.dumps(payload),
                       capture_output=True, text=True, env=e, timeout=30)
    return p.returncode, p.stdout


def denied(out):
    return '"permissionDecision": "deny"' in out or '"permissionDecision":"deny"' in out


class AttributionGuard(unittest.TestCase):
    def bash(self, cmd, cwd=None):
        return hook("attribution-guard.sh", {"tool_name": "Bash", "cwd": cwd or "/tmp",
                                             "tool_input": {"command": cmd}})

    def test_refuses_trailer_in_commit(self):
        rc, out = self.bash(f'git commit -m "feat: x\n\n{TRAILER}"')
        self.assertEqual(rc, 0)
        self.assertTrue(denied(out), out)

    def test_refuses_generated_with_in_pr(self):
        rc, out = self.bash('gh pr create --title t --body "Generated with [Claude Code](https://claude.com/claude-code)"')
        self.assertTrue(denied(out), out)

    def test_refuses_trailer_in_message_file(self):
        d = tempfile.mkdtemp()
        f = Path(d) / "msg.txt"
        f.write_text(f"fix: y\n\n{TRAILER}\n")
        rc, out = self.bash(f"git -C {d} commit -F {f}")
        self.assertTrue(denied(out), out)

    def test_refuses_trailer_in_gh_body_file(self):
        d = tempfile.mkdtemp()
        f = Path(d) / "body.md"
        f.write_text("Summary\n\nGenerated with [Claude Code](https://claude.com/claude-code)\n")
        self.assertTrue(denied(self.bash(f"gh pr create --title t --body-file {f}")[1]))

    def test_plain_commit_and_human_coauthor_pass(self):
        self.assertFalse(denied(self.bash('git commit -m "feat: add thing"')[1]))
        self.assertFalse(denied(self.bash('git commit -m "feat: pair\n\nCo-Authored-By: Gavin <g@x.com>"')[1]))

    def test_prose_and_human_named_claude_pass(self):
        # Review of 8e082d45: the first pattern refused all three.
        for cmd in ('git commit -m "docs: the guard refuses Generated with Claude Code trailers"',
                    'git commit -m "feat: x\n\nCo-authored-by: Claude Dupont <claude@dupont.fr>"',
                    'git commit -m x; echo "Co-Authored-By: Claude" > notes.txt'):
            self.assertFalse(denied(self.bash(cmd)[1]), cmd)

    def test_a_script_mentioning_gh_pr_is_not_a_pr(self):
        cmd = "python3 - <<'EOF'\nx = self.bash(f\"gh pr create --body 'Generated with [Claude Code](u)'\")\nEOF"
        self.assertFalse(denied(self.bash(cmd)[1]))

    def test_relative_and_home_message_files_resolve(self):
        d = tempfile.mkdtemp()
        (Path(d) / "msg.txt").write_text(f"fix: y\n\n{TRAILER}\n")
        self.assertTrue(denied(self.bash("git commit -F msg.txt", cwd=d)[1]))
        home = tempfile.mkdtemp()
        (Path(home) / "m.txt").write_text(f"fix: y\n\n{TRAILER}\n")
        rc, out = hook("attribution-guard.sh", {"tool_name": "Bash", "cwd": "/",
                                                "tool_input": {"command": "git commit -F ~/m.txt"}}, {"HOME": home})
        self.assertTrue(denied(out))

    def test_break_it_shapes_are_refused(self):
        # Break-it, 2026-10-19: every one of these got through.
        d = tempfile.mkdtemp()
        (Path(d) / "msg").write_text(f"fix: y\n\n{TRAILER}\n")
        for cmd in (f'/usr/bin/git commit -m "x\n\n{TRAILER}"',
                    f'env X=1 git commit -m "x\n\n{TRAILER}"',
                    f'git --no-pager commit -m "x\n\n{TRAILER}"',
                    f'git --git-dir=.git commit -m "x\n\n{TRAILER}"',
                    f"git commit -F{d}/msg",
                    f"git commit -aF {d}/msg",
                    f'git commit -m "$(cat {d}/msg)"',
                    f'gh pr create --title t --body "$(cat {d}/msg)"',
                    'git commit -m x --trailer "Co-Authored-By=Claude Opus 5 <noreply@anthropic.com>"',
                    'git commit -m "feat: x\n\nGenerated with Claude Code"'):
            self.assertTrue(denied(self.bash(cmd, cwd=d)[1]), cmd)

    def test_mention_outside_a_commit_passes(self):
        self.assertFalse(denied(self.bash(f'grep -r "{TRAILER}" .')[1]))


class ArtifactGuard(unittest.TestCase):
    def call(self, tool_input, env=None):
        return hook("artifact-guard.sh", {"tool_name": "Artifact", "tool_input": tool_input}, env)

    def test_refuses_publish(self):
        self.assertTrue(denied(self.call({"file_path": "/tmp/x.html"})[1]))
        self.assertTrue(denied(self.call({"action": "publish", "file_path": "/tmp/x.html"})[1]))

    def test_reads_and_deletes_pass(self):
        for action in ("read", "list", "open", "quickstart", "delete"):
            self.assertFalse(denied(self.call({"action": action, "url": "u"})[1]), action)

    def test_opt_out(self):
        self.assertFalse(denied(self.call({"file_path": "/tmp/x.html"}, {"CHEWBACCA_ARTIFACTS": "1"})[1]))


class CommitMsg(unittest.TestCase):
    def setUp(self):
        self.repo = Path(tempfile.mkdtemp())
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", HOME=str(self.repo),
                        GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                        GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        self.env.pop("NO_TEST_OK", None)
        self.git("init", "-q")
        (self.repo / ".githooks").mkdir()
        shutil.copy(COMMIT_MSG, self.repo / ".githooks" / "commit-msg")
        self.git("config", "core.hooksPath", ".githooks")

    def tearDown(self):
        shutil.rmtree(self.repo, ignore_errors=True)

    def git(self, *args, env=None):
        return subprocess.run(["git", *args], cwd=self.repo, capture_output=True, text=True,
                              env=env or self.env)

    def commit(self, files, msg, env=None):
        for f in files:
            p = self.repo / f
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(f"{f} {msg}\n")
            self.git("add", f)
        return self.git("commit", "-q", "-m", msg, env=env).returncode

    def test_refuses_ai_trailer(self):
        self.assertNotEqual(self.commit(["README.md"], f"docs: x\n\n{TRAILER}"), 0)

    def test_refuses_code_fix_without_test(self):
        self.assertNotEqual(self.commit(["tools/a.py"], "fix: a crash"), 0)
        self.assertNotEqual(self.commit([".claude/hooks/g.sh"], "fix(guard): bypass"), 0)

    def test_fix_with_test_passes(self):
        self.assertEqual(self.commit(["tools/a.py", "tests/test_a.py"], "fix: a crash"), 0)
        self.assertEqual(self.commit(["hud/Sources/K/A.swift", "hud/Tests/KTests/ATests.swift"], "fix: b"), 0)

    def test_docs_skill_and_setup_fixes_pass(self):
        self.assertEqual(self.commit(["skills/x/SKILL.md"], "fix: skill wording"), 0)
        self.assertEqual(self.commit(["setup.sh", "SHA256SUMS.txt"], "fix: link a tool onto PATH"), 0)

    def test_prose_and_human_named_claude_pass(self):
        self.assertEqual(self.commit(["README.md"], "docs: commit-msg refuses Generated with Claude Code lines"), 0)
        self.assertEqual(self.commit(["README.md"], "feat: pair\n\nCo-authored-by: Claude Dupont <claude@dupont.fr>"), 0)
        self.assertNotEqual(self.commit(["README.md"], "docs: x\n\nGenerated with [Claude Code](https://claude.com/claude-code)"), 0)
        self.assertNotEqual(self.commit(["README.md"], "docs: x\n\nCo-Authored-By: GPT-5 Codex <codex@openai.com>"), 0)

    def test_amend_counts_the_whole_commit(self):
        # Review of 8e082d45: an amend only staged the new change against HEAD.
        self.assertEqual(self.commit(["README.md"], "docs: base"), 0)
        self.assertEqual(self.commit(["bin/x.sh", "tests/x.sh"], "fix: x"), 0)
        (self.repo / "bin/x.sh").write_text("changed\n")
        self.git("add", "bin/x.sh")
        self.assertEqual(self.git("commit", "-q", "--amend", "--no-edit").returncode, 0)

    def test_bypass_with_reason_and_non_fix(self):
        env = dict(self.env, NO_TEST_OK="mode bit only")
        self.assertEqual(self.commit(["bin/x"], "fix: mode bit", env=env), 0)
        self.assertEqual(self.commit(["tools/b.py"], "feat: new tool"), 0)


class LandRunsCommitMsg(unittest.TestCase):
    """land --paths commits with --no-verify, so it must run commit-msg itself."""

    def test_land_paths_refuses_code_fix_without_test(self):
        t = Path(tempfile.mkdtemp())
        env = dict(os.environ, HOME=str(t / "home"), CHEWBACCA_HOME=str(t / "home/.chewbacca"),
                   GIT_CONFIG_NOSYSTEM="1", GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                   GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        env.pop("NO_TEST_OK", None)
        (t / "home").mkdir()

        def run(*a, cwd):
            return subprocess.run(list(a), cwd=cwd, capture_output=True, text=True, env=env)
        run("git", "init", "-q", "--bare", "-b", "main", str(t / "origin.git"), cwd=t)
        run("git", "clone", "-q", str(t / "origin.git"), str(t / "seed"), cwd=t)
        seed = t / "seed"
        (seed / "tools").mkdir()
        (seed / ".githooks").mkdir()
        shutil.copy(ROOT / "tools" / "checksums.py", seed / "tools" / "checksums.py")
        shutil.copy(COMMIT_MSG, seed / ".githooks" / "commit-msg")
        (seed / "tools" / "a.py").write_text("x = 1\n")
        run("git", "checkout", "-q", "-b", "main", cwd=seed)
        run("git", "add", "-A", cwd=seed)
        run("git", "commit", "-qm", "init", cwd=seed)
        run("git", "push", "-q", "origin", "main", cwd=seed)
        run("git", "clone", "-q", str(t / "origin.git"), str(t / "shared"), cwd=t)
        shared = t / "shared"
        (shared / "tools" / "a.py").write_text("x = 2\n")
        land = ROOT / "bin" / "chewbacca-land"
        p = run(sys.executable, "-I", str(land), "--paths", "tools/a.py", "-m", "fix: x is 2", cwd=shared)
        self.assertNotEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("no test", p.stdout + p.stderr)
        log = run("git", "log", "--oneline", "origin/main", cwd=shared).stdout
        self.assertNotIn("x is 2", log)
        shutil.rmtree(t, ignore_errors=True)


class LandShaChecksAttribution(unittest.TestCase):
    def test_land_sha_refuses_a_trailer_made_with_no_verify(self):
        t = Path(tempfile.mkdtemp())
        env = dict(os.environ, HOME=str(t / "home"), CHEWBACCA_HOME=str(t / "home/.chewbacca"),
                   GIT_CONFIG_NOSYSTEM="1", GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                   GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        (t / "home").mkdir()

        def run(*a, cwd):
            return subprocess.run(list(a), cwd=cwd, capture_output=True, text=True, env=env)
        run("git", "init", "-q", "--bare", "-b", "main", str(t / "origin.git"), cwd=t)
        run("git", "clone", "-q", str(t / "origin.git"), str(t / "seed"), cwd=t)
        seed = t / "seed"
        (seed / "tools").mkdir()
        (seed / ".githooks").mkdir()
        shutil.copy(ROOT / "tools" / "checksums.py", seed / "tools" / "checksums.py")
        shutil.copy(COMMIT_MSG, seed / ".githooks" / "commit-msg")
        (seed / "a.txt").write_text("a\n")
        run("git", "checkout", "-q", "-b", "main", cwd=seed)
        run("git", "add", "-A", cwd=seed)
        run("git", "commit", "-qm", "init", cwd=seed)
        run("git", "push", "-q", "origin", "main", cwd=seed)
        (seed / "a.txt").write_text("b\n")
        run("git", "commit", "-q", "--no-verify", "-am", f"docs: b\n\n{TRAILER}", cwd=seed)
        sha = run("git", "rev-parse", "HEAD", cwd=seed).stdout.strip()
        p = run(sys.executable, "-I", str(ROOT / "bin" / "chewbacca-land"), sha, cwd=seed)
        self.assertNotEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("AI attribution", p.stdout + p.stderr)
        shutil.rmtree(t, ignore_errors=True)


class RuleChecks(unittest.TestCase):
    def test_registry_verifies_on_this_tree(self):
        self.assertEqual(rule_checks.problems(rule_checks.load()), [])

    def test_share_is_the_step_15_number(self):
        checked, total = rule_checks.share(rule_checks.load())
        # 12 of 22 on 10/11 (context-budget.md), 15 of 22 after step 15.
        self.assertGreaterEqual(checked / total, 15 / 22 - 1e-9)

    def test_floor_drop_fails(self):
        reg = rule_checks.load()
        for r in reg["rules"]:
            if r["id"] == "never-publish-an-artifact":
                r["status"], r["checks"] = "prose", []
        self.assertTrue(any("under the floor" in p for p in rule_checks.problems(reg)))

    def test_missing_or_unregistered_check_fails(self):
        reg = rule_checks.load()
        reg["rules"][0]["checks"] = [".claude/hooks/no-such-guard.sh"]
        self.assertTrue(any("does not exist" in p for p in rule_checks.problems(reg)))
        d = Path(tempfile.mkdtemp())
        (d / ".claude/hooks").mkdir(parents=True)
        g = d / ".claude/hooks/x-guard.sh"
        g.write_text("#!/bin/bash\n")
        g.chmod(0o755)
        (d / "setup.sh").write_text("# nothing registered\n")
        reg = {"floor": 0, "rules": [{"id": "x", "status": "check", "checks": [".claude/hooks/x-guard.sh"]}]}
        self.assertTrue(any("not registered" in p for p in rule_checks.problems(reg, d)))


if __name__ == "__main__":
    unittest.main()
