"""pre-commit refuses a tracked file staged as 0 bytes when HEAD has content."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class EmptiedFileGuardTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        self.git('init', '-q')
        self.git('config', 'user.email', 't@example.com')
        self.git('config', 'user.name', 't')
        (self.repo / 'setup.sh').write_text('echo install\n')
        self.git('add', 'setup.sh')
        self.git('commit', '-q', '-m', 'seed')
        self.git('config', 'core.hooksPath', str(ROOT / '.githooks'))

    def git(self, *args, env=None):
        return subprocess.run(['git', *args], cwd=self.repo, capture_output=True, text=True,
                              env=dict(os.environ, SKIP_MANIFEST_GUARD='1', **(env or {})))

    def test_emptied_file_is_refused_even_with_the_stale_staged_bypass(self):
        (self.repo / 'setup.sh').write_text('')
        self.git('add', 'setup.sh')
        result = self.git('commit', '-q', '-m', 'oops', '--', 'setup.sh', env={'ALLOW_STALE_STAGED': '1'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('EMPTY', result.stderr)

    def test_explicit_bypass_allows_it(self):
        (self.repo / 'setup.sh').write_text('')
        self.git('add', 'setup.sh')
        result = self.git('commit', '-q', '-m', 'meant it', '--', 'setup.sh',
                          env={'ALLOW_STALE_STAGED': '1', 'ALLOW_EMPTIED': '1'})
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_a_normal_edit_passes(self):
        (self.repo / 'setup.sh').write_text('echo install v2\n')
        self.git('add', 'setup.sh')
        result = self.git('commit', '-q', '-m', 'edit', '--', 'setup.sh', env={'ALLOW_STALE_STAGED': '1'})
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
