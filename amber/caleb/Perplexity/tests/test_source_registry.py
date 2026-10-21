import tempfile
import unittest
from pathlib import Path

from perplexity_code.source_registry import (
    add_source, remove_source, list_sources, load_registry,
    init_default_sources, stage_update, list_staged, apply_staged,
)


class SourceRegistryTests(unittest.TestCase):
    def test_add_and_list_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            add_source(root, "test-repo", "https://github.com/test/repo.git", "commands", "Test repo")
            sources = list_sources(root)
            self.assertEqual(len(sources), 1)
            self.assertEqual(sources[0]["name"], "test-repo")

    def test_no_duplicate_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            add_source(root, "repo1", "https://github.com/test/repo.git", "commands")
            add_source(root, "repo1-dup", "https://github.com/test/repo.git", "commands")
            sources = list_sources(root)
            self.assertEqual(len(sources), 1)

    def test_remove_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            add_source(root, "to-remove", "https://github.com/test/remove.git", "rules")
            self.assertTrue(remove_source(root, "to-remove"))
            self.assertEqual(len(list_sources(root)), 0)

    def test_init_default_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            count = init_default_sources(root)
            self.assertGreater(count, 0)
            sources = list_sources(root)
            self.assertGreater(len(sources), 0)

    def test_stage_and_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            stage_update(root, "test-src", "command", "my-cmd", "# Command content\nDo stuff.")
            staged = list_staged(root)
            self.assertEqual(len(staged), 1)

    def test_apply_staged_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".perplexity" / "commands").mkdir(parents=True)
            stage_update(root, "test-src", "command", "new-cmd", "# New command\nDo stuff.")
            staged = list_staged(root)
            result = apply_staged(root, staged[0])
            self.assertIn("Applied", result)
            self.assertTrue((root / ".perplexity" / "commands" / "new-cmd.md").exists())
            self.assertEqual(len(list_staged(root)), 0)


if __name__ == "__main__":
    unittest.main()
