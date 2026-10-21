import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from perplexity_code.cli import (
    build_system_prompt,
    build_plan_system_prompt,
    load_project_memory,
    get_git_status_short,
    compact_history_item,
    prune_history,
    RECENT_FILES,
    SESSION_SUMMARY,
    CONTEXT_BUDGET,
)


class LoadProjectMemoryTests(unittest.TestCase):
    def test_loads_perplexity_md(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                Path("PERPLEXITY.md").write_text("project notes here")
                result = load_project_memory()
                self.assertEqual(result, "project notes here")
            finally:
                os.chdir(old)

    def test_returns_empty_when_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                result = load_project_memory()
                self.assertEqual(result, "")
            finally:
                os.chdir(old)


class CompactHistoryItemTests(unittest.TestCase):
    def test_short_content(self):
        result = compact_history_item({"role": "user", "content": "hello"})
        self.assertEqual(result, "user: hello")

    def test_long_content_truncated(self):
        result = compact_history_item({"role": "assistant", "content": "x" * 300})
        self.assertIn("...", result)
        self.assertTrue(len(result) < 260)

    def test_newlines_stripped(self):
        result = compact_history_item({"role": "user", "content": "line1\nline2\nline3"})
        self.assertNotIn("\n", result)


class PruneHistoryTests(unittest.TestCase):
    def setUp(self):
        SESSION_SUMMARY.clear()

    def test_prunes_to_budget(self):
        history = [{"role": "user", "content": f"msg {i}"} for i in range(30)]
        prune_history(history)
        self.assertLessEqual(len(history), CONTEXT_BUDGET)
        self.assertTrue(len(SESSION_SUMMARY) > 0)

    def test_summary_capped_at_60(self):
        import perplexity_code.cli as cli_mod
        cli_mod.SESSION_SUMMARY = [f"old {i}" for i in range(70)]
        history = [{"role": "user", "content": f"msg {i}"} for i in range(30)]
        prune_history(history)
        self.assertLessEqual(len(cli_mod.SESSION_SUMMARY), 60)


class BuildSystemPromptTests(unittest.TestCase):
    def test_includes_base_prompt(self):
        prompt = build_system_prompt()
        self.assertIn("Perplexity Code", prompt)
        self.assertIn("JSON", prompt)

    def test_includes_memory_when_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                Path("PERPLEXITY.md").write_text("my project rules")
                prompt = build_system_prompt()
                self.assertIn("my project rules", prompt)
            finally:
                os.chdir(old)


class BuildPlanSystemPromptTests(unittest.TestCase):
    def test_includes_plan_instructions(self):
        prompt = build_plan_system_prompt()
        self.assertIn("planning mode", prompt)

    def test_includes_memory(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                Path("PERPLEXITY.md").write_text("plan rules")
                prompt = build_plan_system_prompt()
                self.assertIn("plan rules", prompt)
            finally:
                os.chdir(old)


if __name__ == "__main__":
    unittest.main()
