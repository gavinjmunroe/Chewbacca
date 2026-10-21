import os
import tempfile
import unittest
from pathlib import Path

from perplexity_code.cli import list_perplexity_commands, load_perplexity_commands


class DynamicCommandsTests(unittest.TestCase):
    def test_load_perplexity_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            os.chdir(tmp)
            try:
                Path(".perplexity/commands").mkdir(parents=True)
                Path(".perplexity/commands/review.md").write_text("hello review")
                Path(".perplexity/commands/ship.txt").write_text("ship it")
                commands = load_perplexity_commands()
                self.assertEqual(commands["review"], "hello review")
                self.assertEqual(commands["ship"], "ship it")
                self.assertEqual(list_perplexity_commands(), ["review", "ship"])
            finally:
                os.chdir(old)


if __name__ == "__main__":
    unittest.main()
