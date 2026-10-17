#!/usr/bin/env python3
"""The installer keeps a user's own instructions byte for byte (backlog 250).

Two writers put a managed region into a file somebody may have written by
hand: bin/lib/merge-claude-md.sh (setup.sh, ~/.claude/CLAUDE.md) and
agent_context.merge_block (chewbacca agent setup, AGENTS.md and the CLAUDE.md
context block). Every case runs in a scratch HOME and never reads the real one.

What these pin down, each found by running the fixtures on 2026-10-16:
- CRLF outside the region came back as LF: both writers read with universal
  newlines, so a Windows-edited file changed on its first reinstall.
- merge_block rstripped the user's trailing whitespace on first install.
- A second identical run rewrote the file anyway, so it was never a no-op.
- A BEGIN with no END printed "updated" and installed nothing.
- A symlinked CLAUDE.md was replaced by a regular file on first merge.
- A read-only CLAUDE.md was silently replaced by a writable one.
- A hand-edited managed region was overwritten with no backup.
"""
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MERGE = ROOT / 'bin' / 'lib' / 'merge-claude-md.sh'
sys.path.insert(0, str(ROOT / 'tools'))

BEGIN, END = b'<!-- CHEWBACCA:BEGIN -->', b'<!-- CHEWBACCA:END -->'
# CRLF, backslashes that re.sub would read as escapes or group references,
# non-ASCII, and a comment that looks like a marker but is not one.
USER = ('# Mine\r\nUse tabs, not \\t or \\n.\r\nPath C:\\Users\\me\\1 and \\g<0>\r\n'
        'naïve café 日本 ✝\r\n<!-- CHEWBACCA notes, not a marker -->\r\n  trailing  \r\n\r\n').encode()
STANDARDS = 'Rule one, with \\1 and \\g<0> and C:\\new.\nSecond line.\n'.encode()


def backups(path):
    return sorted(path.parent.glob(path.name + '.yours-*'))


def outside(data, begin=BEGIN, end=END):
    start, close = data.index(begin), data.index(end) + len(end)
    return data[:start], data[close:]


class ClaudeMdMerge(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.home = self.tmp / 'home'
        (self.home / '.claude').mkdir(parents=True)
        self.target = self.home / '.claude' / 'CLAUDE.md'
        self.standards = self.tmp / 'standards.md'
        self.standards.write_bytes(STANDARDS)

    def run_merge(self):
        env = dict(os.environ, HOME=str(self.home))
        done = subprocess.run(['bash', str(MERGE), str(self.target), str(self.standards)],
                              capture_output=True, env=env, timeout=60)
        return done.returncode, done.stdout.decode().strip()

    def test_first_install_keeps_user_bytes_and_backs_up(self):
        self.target.write_bytes(USER)
        self.assertEqual(self.run_merge(), (0, 'merged'))
        data = self.target.read_bytes()
        self.assertTrue(data.endswith(USER), 'user text is not a byte-exact suffix')
        self.assertEqual(data.count(BEGIN), 1)
        self.assertIn(STANDARDS, data)
        [backup] = backups(self.target)
        self.assertEqual(backup.read_bytes(), USER)

    def test_second_run_is_a_noop(self):
        self.target.write_bytes(USER)
        self.run_merge()
        before = self.target.read_bytes()
        past = time.time() - 100
        os.utime(self.target, (past, past))
        count = len(backups(self.target))
        self.assertEqual(self.run_merge(), (0, 'unchanged'))
        self.assertEqual(self.target.read_bytes(), before)
        self.assertEqual(int(self.target.stat().st_mtime), int(past), 'a no-op rewrote the file')
        self.assertEqual(len(backups(self.target)), count)

    def test_upgrade_keeps_crlf_and_backslashes_outside_the_region(self):
        self.target.write_bytes(USER)
        self.run_merge()
        head, tail = outside(self.target.read_bytes())
        self.standards.write_bytes(STANDARDS + b'Rule two \\2.\n')
        self.assertEqual(self.run_merge(), (0, 'updated'))
        data = self.target.read_bytes()
        self.assertEqual(outside(data), (head, tail))
        self.assertIn(b'Rule two \\2.', data)
        self.assertTrue(data.endswith(USER))

    def test_hand_edited_region_is_backed_up_before_replacing(self):
        self.target.write_bytes(USER)
        self.run_merge()
        edited = self.target.read_bytes().replace(b'Second line.', b'My own edit.')
        self.target.write_bytes(edited)
        count = len(backups(self.target))
        self.assertEqual(self.run_merge(), (0, 'updated'))
        new = backups(self.target)
        self.assertEqual(len(new), count + 1)
        self.assertIn(edited, [b.read_bytes() for b in new])
        self.assertTrue(self.target.read_bytes().endswith(USER))

    def test_missing_end_marker_refuses_and_writes_nothing(self):
        broken = USER + BEGIN + b'\nhalf a region\n'
        self.target.write_bytes(broken)
        code, out = self.run_merge()
        self.assertNotEqual(code, 0)
        self.assertEqual(out, 'refused')
        self.assertEqual(self.target.read_bytes(), broken)

    def test_symlinked_claude_md_stays_a_symlink(self):
        dotfiles = self.tmp / 'dotfiles' / 'CLAUDE.md'
        dotfiles.parent.mkdir()
        dotfiles.write_bytes(USER)
        self.target.symlink_to(dotfiles)
        self.assertEqual(self.run_merge()[0], 0)
        self.assertTrue(self.target.is_symlink(), 'the dotfiles link was replaced')
        self.assertTrue(dotfiles.read_bytes().endswith(USER))
        self.assertEqual(self.run_merge(), (0, 'unchanged'))

    def test_read_only_file_is_left_alone(self):
        self.target.write_bytes(USER)
        self.target.chmod(0o444)
        try:
            code, out = self.run_merge()
            self.assertNotEqual(code, 0)
            self.assertEqual(out, 'refused')
            self.assertEqual(self.target.read_bytes(), USER)
            self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o444)
        finally:
            self.target.chmod(0o644)

    def test_no_file_writes_and_identical_file_is_adopted(self):
        self.assertEqual(self.run_merge(), (0, 'wrote'))
        self.assertEqual(self.run_merge(), (0, 'unchanged'))
        self.target.write_bytes(STANDARDS)
        self.assertEqual(self.run_merge(), (0, 'adopted'))
        self.assertEqual(backups(self.target), [])


class AgentsMdMerge(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        os.environ['HOME'] = str(self.tmp / 'home')
        import agent_context
        self.context = agent_context
        self.begin, self.end = '<!-- T BEGIN -->', '<!-- T END -->'
        self.target = self.tmp / 'home' / '.codex' / 'AGENTS.md'
        self.target.parent.mkdir(parents=True)

    def block(self, body='Block \\1 \\g<0>.'):
        return f'{self.begin}\n{body}\n{self.end}'

    def merge(self, body='Block \\1 \\g<0>.'):
        return self.context.merge_block(self.target, self.block(body), self.begin, self.end)

    def test_first_install_keeps_user_bytes_and_backs_up(self):
        self.target.write_bytes(USER)
        self.merge()
        data = self.target.read_bytes()
        self.assertTrue(data.startswith(USER), 'user text is not a byte-exact prefix')
        self.assertEqual(data.count(self.begin.encode()), 1)
        [backup] = backups(self.target)
        self.assertEqual(backup.read_bytes(), USER)

    def test_second_run_is_a_noop_and_upgrade_keeps_crlf(self):
        self.target.write_bytes(USER)
        self.merge()
        before = self.target.read_bytes()
        past = time.time() - 100
        os.utime(self.target, (past, past))
        self.merge()
        self.assertEqual(self.target.read_bytes(), before)
        self.assertEqual(int(self.target.stat().st_mtime), int(past), 'a no-op rewrote the file')
        head, tail = outside(before, self.begin.encode(), self.end.encode())
        self.merge('Block v2 \\2.')
        after = self.target.read_bytes()
        self.assertEqual(outside(after, self.begin.encode(), self.end.encode()), (head, tail))
        self.assertIn(b'Block v2 \\2.', after)

    def test_missing_end_marker_refuses(self):
        broken = USER + self.begin.encode() + b'\nhalf\n'
        self.target.write_bytes(broken)
        with self.assertRaises(ValueError):
            self.merge()
        self.assertEqual(self.target.read_bytes(), broken)

    def test_symlink_and_read_only(self):
        real = self.tmp / 'dotfiles.md'
        real.write_bytes(USER)
        self.target.symlink_to(real)
        self.merge()
        self.assertTrue(self.target.is_symlink())
        self.assertTrue(real.read_bytes().startswith(USER))
        self.target.unlink()
        self.target.write_bytes(USER)
        self.target.chmod(0o444)
        try:
            with self.assertRaises(PermissionError):
                self.merge()
            self.assertEqual(self.target.read_bytes(), USER)
        finally:
            self.target.chmod(0o644)


if __name__ == '__main__':
    unittest.main(verbosity=1)
