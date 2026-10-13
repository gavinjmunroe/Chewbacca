"""chewbacca week: the first-minute line must be true, checkable and quiet.

Each number in the line has to match git, worktrees and landed-elsewhere
commits must not inflate it, and the walk must never enter ~/Documents (a
privacy dialog on macOS, on the first thing a new install shows)."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import first_win

EMAIL = 'dev@example.com'


def git(repo, *args):
    subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True)


def commit(repo, name, message):
    (repo / name).write_text(message + '\n')
    git(repo, 'add', name)
    git(repo, 'commit', '-q', '-m', message)


class WeekTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        gitconfig = self.home / '.gitconfig'
        gitconfig.write_text(f'[user]\n\temail = {EMAIL}\n\tname = Dev\n[init]\n\tdefaultBranch = main\n')
        env = patch.dict(os.environ, {'HOME': str(self.home), 'GIT_CONFIG_GLOBAL': str(gitconfig),
                                      'GIT_CONFIG_NOSYSTEM': '1',
                                      'CHEWBACCA_HOME': str(self.home / '.chewbacca')})
        env.start()
        self.addCleanup(env.stop)

        # A repo with no remote, two commits this week, one uncommitted file.
        self.solo = self.home / 'code/solo'
        self.solo.mkdir(parents=True)
        git(self.solo, 'init', '-q')
        commit(self.solo, 'a.txt', 'first')
        commit(self.solo, 'b.txt', 'second')
        (self.solo / 'scratch.txt').write_text('unsaved\n')
        # A worktree of it: same history, must not double the commit count.
        git(self.solo, 'worktree', 'add', '-q', '-b', 'side', str(self.home / 'code/solo-wt'))

        # A clone with one pushed commit, one never pushed, and one that
        # landed on the remote under a new hash (cherry-picked).
        bare = self.home / 'remote.git'
        git(self.home, 'init', '-q', '--bare', str(bare))
        self.app = self.home / 'code/org/app'
        self.app.parent.mkdir(parents=True)
        git(self.home, 'clone', '-q', str(bare), str(self.app))
        commit(self.app, 'base.txt', 'pushed')
        git(self.app, 'push', '-q', 'origin', 'main')
        commit(self.app, 'landed.txt', 'landed elsewhere')
        landed = subprocess.run(['git', '-C', str(self.app), 'rev-parse', 'HEAD'],
                                capture_output=True, text=True).stdout.strip()
        commit(self.app, 'local.txt', 'only here')
        other = self.home / 'other'
        git(self.home, 'clone', '-q', str(bare), str(other))
        git(other, 'fetch', '-q', str(self.app), landed)
        # A different committer guarantees a new hash; the author is kept.
        git(other, '-c', 'user.name=Lander', '-c', 'user.email=lander@example.com', 'cherry-pick', landed)
        self.assertNotIn(landed, subprocess.run(['git', '-C', str(other), 'log', '--format=%H'],
                                                capture_output=True, text=True).stdout)
        git(other, 'push', '-q', 'origin', 'main')
        git(self.app, 'fetch', '-q')

        # Someone else's commit this week: not "yours".
        subprocess.run(['git', '-C', str(self.app), '-c', 'user.email=else@example.com',
                        'commit', '-q', '--allow-empty', '-m', 'theirs'], check=True)

        # A repo in ~/Documents: reading it raises a macOS privacy dialog.
        private = self.home / 'Documents/private'
        private.mkdir(parents=True)
        git(private, 'init', '-q')
        commit(private, 'x.txt', 'private')

    def test_line_counts_match_git(self):
        result = first_win.week(self.home)
        self.assertEqual(result['line'],
                         'Your week: 5 commits in 2 repos (most in app, 3). '
                         f'Only on this {"Mac" if sys.platform == "darwin" else "machine"}: '
                         '1 repo with uncommitted changes, 1 commit from this week on no remote, '
                         '1 repo with no remote at all.')
        # 'landed elsewhere' is on origin under another hash, so it is pushed.
        self.assertEqual([r['ahead'] for r in result['ahead']], [1])

    def test_never_walks_into_documents(self):
        paths = [r['path'] for r in first_win.week(self.home)['repos']]
        self.assertFalse([p for p in paths if '/Documents/' in p])
        self.assertEqual(len(paths), 3)  # solo, its worktree, app

    def test_receipt_commands_reproduce_the_counts(self):
        result = first_win.week(self.home)
        path = first_win.receipt(result, self.home / '.chewbacca/receipts')
        text = path.read_text()
        self.assertIn(result['line'], text)
        line = next(l for l in text.splitlines() if l.startswith('- solo: '))
        command = line.split('`')[1]
        counted = subprocess.run(command, shell=True, capture_output=True, text=True).stdout.strip()
        self.assertEqual(counted, '2')

    def test_a_cloned_repo_cannot_run_its_own_config(self):
        # Any repo under ~/code may be a stranger's clone. Plain `git status`
        # runs its core.fsmonitor command (seen: it touched the marker).
        evil = self.home / 'code/evil'
        evil.mkdir()
        git(evil, 'init', '-q')
        commit(evil, 'a.txt', 'x')
        marker = self.home / 'PWNED'
        git(evil, 'config', 'core.fsmonitor', f'touch {marker}.fsmonitor; echo')
        git(evil, 'config', 'filter.evil.clean', f'touch {marker}.clean; cat')
        (evil / '.gitattributes').write_text('*.txt filter=evil\n')
        (evil / 'a.txt').write_text('changed\n')
        result = first_win.week(self.home)
        self.assertIn('evil', [Path(r['path']).name for r in result['dirty']])
        self.assertEqual(sorted(p.name for p in self.home.glob('PWNED*')), [])

    def test_a_submodule_cannot_run_its_own_config(self):
        sub_src = self.home / 'subsrc'
        sub_src.mkdir()
        git(sub_src, 'init', '-q')
        commit(sub_src, 's.txt', 's')
        parent = self.home / 'code/parent'
        parent.mkdir()
        git(parent, 'init', '-q')
        commit(parent, 'p.txt', 'p')
        git(parent, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', str(sub_src), 'sub')
        marker = self.home / 'PWNED-sub'
        # A clean filter in the submodule's own config: the -c overrides read
        # from the parent's config never name it.
        git(parent / 'sub', 'config', 'filter.evil.clean', f'touch {marker}; cat')
        (parent / 'sub/.gitattributes').write_text('*.txt filter=evil\n')
        (parent / 'sub/s.txt').write_text('t\n')  # same size, so git must hash it
        subprocess.run(['git', '-C', str(parent), 'status', '--porcelain'], capture_output=True)
        self.assertTrue(marker.exists(), 'plain status should reach the submodule, or this test proves nothing')
        marker.unlink()
        first_win.week(self.home)
        self.assertFalse(marker.exists())

    def test_an_odd_filter_name_skips_status_instead_of_guessing(self):
        odd = self.home / 'code/odd'
        odd.mkdir()
        git(odd, 'init', '-q')
        commit(odd, 'a.txt', 'x')
        git(odd, 'config', 'filter.a=b.clean', 'cat')
        self.assertIsNone(first_win.filters_off(odd))
        self.assertEqual(first_win.filters_off(self.solo), [])

    def test_an_amended_commit_is_still_unpushed(self):
        # Same subject and author time as the pushed commit, different content:
        # matching on those two alone called it pushed (review, 10/13).
        (self.app / 'base.txt').write_text('changed after push\n')
        git(self.app, 'add', 'base.txt')
        git(self.app, 'checkout', '-q', '-b', 'amend', 'origin/main')
        (self.app / 'base.txt').write_text('changed after push\n')
        git(self.app, 'commit', '-q', '-a', '--amend', '--no-edit')
        row = first_win.inspect(self.app, EMAIL, '7.days.ago')
        amended = subprocess.run(['git', '-C', str(self.app), 'rev-parse', 'HEAD'],
                                 capture_output=True, text=True).stdout.strip()
        self.assertIn(amended, row['unpushed'])

    def test_an_unchecked_repo_never_reads_as_all_clear(self):
        clean = Path(tempfile.mkdtemp(dir=self.home)) / 'code/clean'
        clean.mkdir(parents=True)
        git(clean, 'init', '-q')
        commit(clean, 'a.txt', 'x')
        git(clean, 'config', 'filter.a=b.clean', 'cat')
        line = first_win.week(clean.parents[1])['line']
        self.assertNotIn('Everything is committed', line)
        self.assertIn('1 repo not checked for uncommitted changes', line)

    def test_receipt_status_command_is_as_safe_as_the_scan(self):
        evil = self.home / 'code/evil'
        evil.mkdir()
        git(evil, 'init', '-q')
        commit(evil, 'a.txt', 'x')
        marker = self.home / 'PWNED-receipt'
        git(evil, 'config', 'core.fsmonitor', f'touch {marker}; echo')
        git(evil, 'config', 'filter.evil.clean', f'touch {marker}; cat')
        (evil / '.gitattributes').write_text('*.txt filter=evil\n')
        (evil / 'a.txt').write_text('y\n')  # same size, so git must hash it
        path = first_win.receipt(first_win.week(self.home), self.home / '.chewbacca/receipts')
        line = next(l for l in path.read_text().splitlines() if l.startswith('- evil: ') and 'uncommitted' in l)
        self.assertFalse(marker.exists())
        subprocess.run(line.split('`')[1], shell=True, capture_output=True)
        self.assertFalse(marker.exists())

    def test_a_signed_commit_cannot_run_the_repos_verifier(self):
        repo = self.home / 'code/signed'
        repo.mkdir()
        git(repo, 'init', '-q')
        commit(repo, 'a.txt', 'x')
        out = lambda *a: subprocess.run(['git', '-C', str(repo), *a], capture_output=True, text=True).stdout.strip()
        body = (f'tree {out("rev-parse", "HEAD^{tree}")}\nparent {out("rev-parse", "HEAD")}\n'
                f'author Dev <{EMAIL}> {int(time.time())} +0000\ncommitter Dev <{EMAIL}> {int(time.time())} +0000\n'
                'gpgsig -----BEGIN PGP SIGNATURE-----\n x\n -----END PGP SIGNATURE-----\n\nsigned\n')
        signed = subprocess.run(['git', '-C', str(repo), 'hash-object', '-t', 'commit', '-w', '--stdin'],
                                input=body, capture_output=True, text=True).stdout.strip()
        git(repo, 'update-ref', 'refs/heads/main', signed)
        marker = self.home / 'PWNED-gpg'
        verifier = self.home / 'verifier.sh'
        verifier.write_text(f'#!/bin/sh\ntouch {marker}\nexit 1\n')
        verifier.chmod(0o755)
        git(repo, 'config', 'log.showSignature', 'true')
        git(repo, 'config', 'gpg.program', str(verifier))
        subprocess.run(['git', '-C', str(repo), 'log', '-1'], capture_output=True)
        self.assertTrue(marker.exists(), 'plain log should run the verifier, or this test proves nothing')
        marker.unlink()
        result = first_win.week(self.home)
        first_win.receipt(result, self.home / '.chewbacca/receipts')
        self.assertFalse(marker.exists())

    def test_empty_machine_says_where_to_point_it(self):
        empty = Path(tempfile.mkdtemp(dir=self.home))
        result = first_win.week(empty)
        self.assertIn('chewbacca week --path', result['line'])


if __name__ == '__main__':
    unittest.main()
