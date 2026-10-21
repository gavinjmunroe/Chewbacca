import os
import tempfile
import unittest
from pathlib import Path

from perplexity_code.cli import split_dynamic_commands


class CommandCollisionTests(unittest.TestCase):
    def test_shadowed_dynamic_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                Path(".perplexity/commands").mkdir(parents=True)
                Path(".perplexity/commands/debug.md").write_text("built-in collision")
                Path(".perplexity/commands/custom.md").write_text("custom command")
                available, shadowed = split_dynamic_commands()
                self.assertEqual(available, ["custom"])
                self.assertEqual(shadowed, ["debug"])
            finally:
                os.chdir(old)


if __name__ == "__main__":
    unittest.main()
