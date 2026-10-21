import tempfile
import unittest
from pathlib import Path

from perplexity_code.command_registry import load_command_registry, get_command_prompt, list_commands_with_descriptions


class CommandRegistryTests(unittest.TestCase):
    def test_load_with_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            cmd_dir = Path(tmp) / ".perplexity" / "commands"
            cmd_dir.mkdir(parents=True)
            (cmd_dir / "build.md").write_text(
                '---\ndescription: Build a feature\nmode: acceptEdits\nrules:\n  - typescript\n  - design\n---\n# Build\nDo the build.'
            )
            registry = load_command_registry(Path(tmp))
            self.assertIn("build", registry)
            self.assertEqual(registry["build"]["description"], "Build a feature")
            self.assertEqual(registry["build"]["mode"], "acceptEdits")
            self.assertEqual(registry["build"]["rules"], ["typescript", "design"])

    def test_get_command_prompt(self):
        registry = {
            "build": {
                "name": "build",
                "description": "Build a feature",
                "body": "Do the build step by step.",
                "allowed_tools": [],
                "mode": None,
                "model": None,
                "rules": [],
                "post_actions": [],
                "path": "commands/build.md",
            }
        }
        prompt, meta = get_command_prompt(registry, "build", "add user auth")
        self.assertIn("build", prompt)
        self.assertIn("add user auth", prompt)

    def test_list_commands_with_descriptions(self):
        registry = {
            "build": {"description": "Build something"},
            "audit": {"description": "Audit code"},
        }
        items = list_commands_with_descriptions(registry)
        self.assertEqual(items[0][0], "audit")
        self.assertEqual(items[1][0], "build")

    def test_empty_registry(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry = load_command_registry(Path(tmp))
            self.assertEqual(len(registry), 0)


if __name__ == "__main__":
    unittest.main()
