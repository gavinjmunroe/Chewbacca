"""pre-push checks the manifest against commits, so another tab's dirty file
never blocks a push whose commits are correct (2026-10-09)."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


class ChecksumRefTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        (self.repo / "tools").mkdir()
        (self.repo / "bin").mkdir()
        shutil.copy(ROOT / "tools/checksums.py", self.repo / "tools/checksums.py")
        (self.repo / "bin/thing").write_text("committed\n")
        git(self.repo, "init", "-q")
        git(self.repo, "-c", "user.name=t", "-c", "user.email=t@t", "add", ".")
        self.run_tool()
        git(self.repo, "add", "SHA256SUMS.txt")
        git(self.repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed")

    def run_tool(self, *args):
        return subprocess.run([sys.executable, "tools/checksums.py", *args],
                              cwd=self.repo, capture_output=True, text=True).returncode

    def test_dirty_working_tree_does_not_fail_ref_check(self):
        (self.repo / "bin/thing").write_text("another tab, mid edit\n")
        self.assertEqual(self.run_tool("--check"), 1)
        self.assertEqual(self.run_tool("--check", "--ref", "HEAD"), 0)

    def test_stale_committed_manifest_still_fails_ref_check(self):
        (self.repo / "bin/thing").write_text("changed and committed\n")
        git(self.repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "change")
        self.assertEqual(self.run_tool("--check", "--ref", "HEAD"), 1)


if __name__ == "__main__":
    unittest.main()
