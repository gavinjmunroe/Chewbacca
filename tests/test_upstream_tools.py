"""upstream_tools names a PATH tool upstream has and the fork lacks (ux-bar, 2026-11-13),
and goes quiet once the fork has it."""
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "tools"))
import upstream_tools  # noqa: E402


def run(repo, *args):
    subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})


def write(repo, path, text="#!/bin/sh\n"):
    full = os.path.join(repo, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(text)


class UpstreamTools(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = self.tmp.name
        run(self.repo, "init", "-q")
        write(self.repo, "bin/chewbacca")
        write(self.repo, "apps/ux-engine/bin/ux-eye")
        write(self.repo, "apps/ux-engine/tests/test_x.py")
        run(self.repo, "add", "-A")
        run(self.repo, "commit", "-qm", "base")
        run(self.repo, "update-ref", "refs/remotes/origin/main", "HEAD")
        write(self.repo, "apps/ux-engine/bin/ux-bar")
        write(self.repo, "apps/ux-engine/tests/test_ux_bar.py")
        write(self.repo, "docs/x.md", "doc\n")
        run(self.repo, "add", "-A")
        run(self.repo, "commit", "-qm", "ux-bar")
        run(self.repo, "update-ref", "refs/remotes/upstream/main", "HEAD")

    def tearDown(self):
        self.tmp.cleanup()

    def test_names_the_missing_tool_and_only_tools(self):
        r = upstream_tools.compare(self.repo)
        self.assertTrue(r["available"])
        self.assertEqual(r["behind"], 1)
        self.assertEqual(r["missing"], ["apps/ux-engine/bin/ux-bar"])
        self.assertEqual(r["missing_names"], ["ux-bar"])

    def test_quiet_once_the_fork_has_it(self):
        run(self.repo, "update-ref", "refs/remotes/origin/main", "refs/remotes/upstream/main")
        r = upstream_tools.compare(self.repo)
        self.assertEqual(r["behind"], 0)
        self.assertEqual(r["missing"], [])

    def test_no_upstream_remote_is_not_an_error(self):
        run(self.repo, "update-ref", "-d", "refs/remotes/upstream/main")
        r = upstream_tools.compare(self.repo)
        self.assertFalse(r["available"])


if __name__ == "__main__":
    unittest.main()
