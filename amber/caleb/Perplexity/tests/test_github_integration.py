"""Tests for github_integration.py using mocked subprocess calls."""

import unittest
from unittest.mock import patch, MagicMock

from perplexity_code.github_integration import (
    get_repo_info,
    get_changed_files,
    get_recent_commits,
    build_github_context,
)


def mock_run(stdout="", stderr="", returncode=0):
    result = MagicMock()
    result.stdout = stdout
    result.stderr = stderr
    result.returncode = returncode
    return result


class GetRepoInfoTests(unittest.TestCase):
    @patch("perplexity_code.github_integration.subprocess.run")
    def test_parse_https_url(self, mock_subprocess):
        mock_subprocess.return_value = mock_run(stdout="https://github.com/calebnewtonusc/perplexity-code.git")
        info = get_repo_info()
        self.assertEqual(info["owner"], "calebnewtonusc")
        self.assertEqual(info["repo"], "perplexity-code")
        self.assertEqual(info["full"], "calebnewtonusc/perplexity-code")

    @patch("perplexity_code.github_integration.subprocess.run")
    def test_parse_ssh_url(self, mock_subprocess):
        mock_subprocess.return_value = mock_run(stdout="git@github.com:calebnewtonusc/amber.git")
        info = get_repo_info()
        self.assertEqual(info["owner"], "calebnewtonusc")
        self.assertEqual(info["repo"], "amber")

    @patch("perplexity_code.github_integration.subprocess.run")
    def test_no_remote(self, mock_subprocess):
        mock_subprocess.return_value = mock_run(returncode=1)
        info = get_repo_info()
        self.assertEqual(info, {})


class GetChangedFilesTests(unittest.TestCase):
    @patch("perplexity_code.github_integration.subprocess.run")
    def test_parse_porcelain(self, mock_subprocess):
        mock_subprocess.return_value = mock_run(stdout=" M src/app.ts\n?? new-file.py\n A staged.ts\n D deleted.ts")
        result = get_changed_files()
        # git status --porcelain uses 2-char status + space, parser takes [3:]
        self.assertTrue(any("app.ts" in f for f in result["modified"]))
        self.assertTrue(any("new-file.py" in f for f in result["untracked"]))
        self.assertTrue(any("staged.ts" in f for f in result["added"]))
        self.assertTrue(any("deleted.ts" in f for f in result["deleted"]))

    @patch("perplexity_code.github_integration.subprocess.run")
    def test_clean_tree(self, mock_subprocess):
        mock_subprocess.return_value = mock_run(stdout="")
        result = get_changed_files()
        self.assertEqual(result, {})


class GetRecentCommitsTests(unittest.TestCase):
    @patch("perplexity_code.github_integration.subprocess.run")
    def test_parse_commits(self, mock_subprocess):
        mock_subprocess.return_value = mock_run(
            stdout="abc12345|feat: add auth|Caleb|2026-04-08 10:00:00 -0700\ndef67890|fix: null crash|Caleb|2026-04-07 15:00:00 -0700"
        )
        commits = get_recent_commits(2)
        self.assertEqual(len(commits), 2)
        self.assertEqual(commits[0]["hash"], "abc12345")
        self.assertEqual(commits[0]["message"], "feat: add auth")


class BuildGithubContextTests(unittest.TestCase):
    @patch("perplexity_code.github_integration.get_recent_commits")
    @patch("perplexity_code.github_integration.get_changed_files")
    @patch("perplexity_code.github_integration.get_repo_info")
    def test_builds_context_string(self, mock_repo, mock_changes, mock_commits):
        mock_repo.return_value = {"full": "calebnewtonusc/perplexity-code"}
        mock_changes.return_value = {"modified": ["cli.py"], "added": [], "deleted": [], "untracked": []}
        mock_commits.return_value = [{"hash": "abc", "message": "test", "author": "Caleb", "date": "2026"}]
        ctx = build_github_context()
        self.assertIn("calebnewtonusc/perplexity-code", ctx)
        self.assertIn("modified", ctx)
        self.assertIn("abc", ctx)


if __name__ == "__main__":
    unittest.main()
