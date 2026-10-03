"""README totals count tracked paths once, including names with whitespace."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('counts', Path(__file__).resolve().parents[1] / 'tools/counts.py')
counts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(counts)


class CountsTests(unittest.TestCase):
    def test_conflict_stages_and_whitespace_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'two words.txt').write_text('first\nsecond\n')
            (root / 'normal.txt').write_text('third\n')
            listing = 'two words.txt\0two words.txt\0two words.txt\0normal.txt\0'
            with patch.object(counts, 'REPO', root), patch.object(counts.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, listing)) as run:
                self.assertEqual(counts.lines(), 3)
                self.assertEqual(run.call_args.args[0], ['git', 'ls-files', '-z'])


if __name__ == '__main__':
    unittest.main()
