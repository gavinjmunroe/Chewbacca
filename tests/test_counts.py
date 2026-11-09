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


    def test_help_and_typos_never_write(self):
        # Break-it, 2026-10-19: any argument but --json or --check rewrote
        # README.md, --help and --dry-run included.
        for arg in ('--help', '--dry-run', '--chek'):
            with patch.object(counts.sys, 'argv', ['counts.py', arg]), \
                 patch.object(counts, 'counts', side_effect=AssertionError('counted, so it would write')), \
                 patch('builtins.print'):
                rc = counts.main()
            self.assertEqual(rc, 0 if arg == '--help' else 2, arg)


if __name__ == '__main__':
    unittest.main()
