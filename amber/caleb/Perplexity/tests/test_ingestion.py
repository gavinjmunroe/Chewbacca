"""Tests for the AI-powered ingestion translation in source_registry."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from perplexity_code.source_registry import (
    translate_source_to_native,
    ingest_source_files,
    list_staged,
)


class TranslateSourceTests(unittest.TestCase):
    @patch.dict("os.environ", {}, clear=True)
    def test_strips_claude_references(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            content = "Use Claude Code to run this. Check ~/.claude/commands/ for details."
            results = translate_source_to_native(root, "test-src", "commands/review.md", content, use_ai=False)
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["type"], "command")
            self.assertEqual(results[0]["name"], "review")

            # Verify staged content has Claude references replaced
            staged = list_staged(root)
            self.assertEqual(len(staged), 1)
            staged_content = staged[0].read_text()
            self.assertNotIn("Claude Code", staged_content)
            self.assertIn("Perplexity Code", staged_content)
            self.assertNotIn("~/.claude", staged_content)
            self.assertIn("~/.perplexity", staged_content)

    @patch.dict("os.environ", {}, clear=True)
    def test_detects_rule_from_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            results = translate_source_to_native(root, "src", "rules/typescript.md", "# TS rules", use_ai=False)
            self.assertEqual(results[0]["type"], "rule")

    @patch.dict("os.environ", {}, clear=True)
    def test_detects_hook_from_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            results = translate_source_to_native(root, "src", "hooks/post-edit.py", "#!/usr/bin/env python3", use_ai=False)
            self.assertEqual(results[0]["type"], "hook")


class IngestSourceFilesTests(unittest.TestCase):
    @patch.dict("os.environ", {}, clear=True)
    def test_ingest_multiple_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = {
                "commands/build.md": "# Build\nBuild stuff with Claude Code.",
                "commands/review.md": "# Review\nReview using .claude/ rules.",
                "rules/ts.md": "# TypeScript\nUse strict mode.",
            }
            results = ingest_source_files(root, "d1", files, use_ai=False)
            self.assertEqual(len(results), 3)
            staged = list_staged(root)
            self.assertEqual(len(staged), 3)

    @patch.dict("os.environ", {}, clear=True)
    def test_skips_empty_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = {
                "commands/empty.md": "",
                "commands/real.md": "# Real content",
            }
            results = ingest_source_files(root, "src", files, use_ai=False)
            self.assertEqual(len(results), 1)


if __name__ == "__main__":
    unittest.main()
