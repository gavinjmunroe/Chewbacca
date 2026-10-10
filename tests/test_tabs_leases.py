"""File leases: a tab that edits a file holds it for a while, and another tab is
warned once before it touches the same file. Runs on stock /usr/bin/python3 3.9."""
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import tabs  # noqa: E402


class LeaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.repo = self.root / 'repo'
        (self.repo / '.git' / 'worktrees' / 'agent-x').mkdir(parents=True)
        # A linked worktree laid out the way git lays one out, without running git.
        self.worktree = self.repo / '.claude' / 'worktrees' / 'agent-x'
        self.worktree.mkdir(parents=True)
        (self.worktree / '.git').write_text(f'gitdir: {self.repo}/.git/worktrees/agent-x\n')
        (self.repo / '.git' / 'worktrees' / 'agent-x' / 'commondir').write_text('../..\n')
        for base in (self.repo, self.worktree):
            (base / 'tools').mkdir()
            (base / 'tools' / 'shared.py').write_text('')
        self.env = {
            'CHEWBACCA_TABS_DB': str(self.root / 'tabs.sqlite'),
            'CHEWBACCA_WRITE_LOG': str(self.root / 'write-log.tsv'),
        }
        patcher = patch.dict(os.environ, self.env)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.target = str(self.repo / 'tools' / 'shared.py')
        # Two live tabs. upsert with an empty cwd never shells out to git.
        tabs.upsert('a', 'claude-code', task='Refactor the shared helper')
        tabs.upsert('b', 'codex', task='Fix the parser')

    def edit(self, session, path, event, runtime='claude-code'):
        return tabs.handle({'hook_event_name': event, 'session_id': session, 'tool_name': 'Edit',
                            'cwd': str(self.repo), 'tool_input': {'file_path': path}}, runtime)

    def test_lease_is_recorded_on_edit(self):
        self.edit('a', self.target, 'PostToolUse')
        rows = tabs.held_leases()
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['repo'], rows[0]['rel'], rows[0]['session']),
                         (str(self.repo), 'tools/shared.py', 'a'))
        self.assertAlmostEqual(rows[0]['expires_at'] - time.time(), tabs.LEASE_SECONDS, delta=5)

    def test_refresh_extends_the_lease(self):
        start = time.time() - 600
        tabs.lease('a', 'claude-code', [self.target], now=start)
        first = tabs.held_leases()[0]['expires_at']
        tabs.lease('a', 'claude-code', [self.target])
        rows = tabs.held_leases()
        self.assertEqual(len(rows), 1, 'a refresh updates the lease, it does not add one')
        self.assertGreater(rows[0]['expires_at'], first + 500)
        self.assertAlmostEqual(rows[0]['acquired'], start, delta=1)

    def test_other_session_is_warned_once(self):
        self.edit('a', self.target, 'PostToolUse')
        warning = self.edit('b', self.target, 'PreToolUse')
        self.assertIn('leased by claude-code', warning)
        self.assertIn('Refactor the shared helper', warning)
        self.assertIn('tools/shared.py', warning)
        self.assertEqual(warning.count('\n'), 0, 'one line')
        self.assertEqual(self.edit('b', self.target, 'PreToolUse'), '', 'second warning suppressed')

    def test_holder_is_never_warned_about_its_own_lease(self):
        self.edit('a', self.target, 'PostToolUse')
        self.assertEqual(self.edit('a', self.target, 'PreToolUse'), '')

    def test_worktree_path_maps_to_the_same_lease(self):
        in_worktree = str(self.worktree / 'tools' / 'shared.py')
        self.assertEqual(tabs.lease_key(in_worktree), tabs.lease_key(self.target))
        self.edit('a', in_worktree, 'PostToolUse')
        self.assertIn('leased by', self.edit('b', self.target, 'PreToolUse'))

    def test_expired_lease_is_ignored(self):
        tabs.lease('a', 'claude-code', [self.target],
                   now=time.time() - tabs.LEASE_SECONDS - tabs.SKEW_SECONDS - 1)
        self.assertEqual(tabs.held_leases(), [])
        self.assertEqual(self.edit('b', self.target, 'PreToolUse'), '')

    def test_skew_margin_keeps_a_just_expired_lease_live_for_others(self):
        tabs.lease('a', 'claude-code', [self.target], now=time.time() - tabs.LEASE_SECONDS - 1)
        self.assertEqual(len(tabs.held_leases()), 1, 'inside epsilon the holder still has it')

    def test_ended_session_releases_its_leases(self):
        self.edit('a', self.target, 'PostToolUse')
        tabs.handle({'hook_event_name': 'SessionEnd', 'session_id': 'a'}, 'claude-code')
        self.assertEqual(tabs.held_leases(), [])
        self.assertEqual(self.edit('b', self.target, 'PreToolUse'), '')

    def test_stale_heartbeat_lease_is_ignored(self):
        self.edit('a', self.target, 'PostToolUse')
        with tabs.connect() as db:
            db.execute("UPDATE sessions SET last_seen=? WHERE id='a'", (time.time() - tabs.LIVE_SECONDS - 60,))
        self.assertEqual(tabs.held_leases(), [])
        self.assertEqual(self.edit('b', self.target, 'PreToolUse'), '')

    def test_leases_cli_lists_them(self):
        self.edit('a', self.target, 'PostToolUse')
        listed = subprocess.run([sys.executable, str(ROOT / 'tools/tabs.py'), 'leases'],
                                capture_output=True, text=True, env=dict(os.environ, **self.env))
        self.assertIn('repo/tools/shared.py', listed.stdout)
        self.assertIn('Refactor the shared helper', listed.stdout)
        as_json = subprocess.run([sys.executable, str(ROOT / 'tools/tabs.py'), 'leases', '--json'],
                                 capture_output=True, text=True, env=dict(os.environ, **self.env))
        self.assertEqual(json.loads(as_json.stdout)[0]['rel'], 'tools/shared.py')

    def test_the_registered_pre_tool_use_event_takes_the_lease(self):
        # setup.sh registers tabs.sh on PreToolUse for file tools, not on
        # PostToolUse, so a lease taken only after the edit was never taken.
        self.assertEqual(self.edit('a', self.target, 'PreToolUse'), '')
        self.assertEqual([r['session'] for r in tabs.held_leases()], ['a'])
        self.assertIn('leased by claude-code', self.edit('b', self.target, 'PreToolUse'))

    def test_tabs_list_shows_who_holds_which_file(self):
        self.edit('a', self.target, 'PreToolUse')
        listed = subprocess.run([sys.executable, str(ROOT / 'tools/tabs.py'), 'list'],
                                capture_output=True, text=True, env=dict(os.environ, **self.env))
        self.assertIn('Live file leases (1)', listed.stdout)
        self.assertIn('repo/tools/shared.py: claude-code a', listed.stdout)

    def test_a_broken_database_never_fails_an_edit(self):
        Path(self.env['CHEWBACCA_TABS_DB']).write_text('not sqlite')
        self.assertEqual(self.edit('a', self.target, 'PostToolUse'), '')
        self.assertEqual(self.edit('b', self.target, 'PreToolUse'), '')

    def timed(self, argv, payload=None):
        started = time.perf_counter()
        result = subprocess.run(argv, input=json.dumps(payload or {}), capture_output=True, text=True,
                                env=dict(os.environ, **self.env), timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        return time.perf_counter() - started, result.stdout

    @unittest.skipUnless(Path('/usr/bin/python3').exists(), 'stock macOS python only')
    def test_hooks_run_on_stock_python_and_stay_fast(self):
        post = {'hook_event_name': 'PostToolUse', 'session_id': 'a', 'tool_name': 'Edit',
                'cwd': str(self.repo), 'tool_input': {'file_path': self.target}}
        pre = dict(post, hook_event_name='PreToolUse', session_id='b')
        hook = ['/usr/bin/python3', str(ROOT / 'tools/tabs.py'), 'hook']
        # What any python hook pays before its first line runs. On 2026-10-10,
        # at load average 93, this alone took 80 to 280 ms, so an absolute
        # 200 ms bound on the whole process measured the Mac, not the hook.
        bare = ['/usr/bin/python3', '-c', 'import sqlite3, subprocess, json, argparse, re']
        self.timed(hook, pre)  # the first PreToolUse looks the repo up once
        post_t, pre_t, bare_t, outputs = [], [], [], []
        for _ in range(7):
            bare_t.append(self.timed(bare)[0])
            post_t.append(self.timed(hook, post)[0])
            seconds, out = self.timed(hook, pre)
            pre_t.append(seconds)
            outputs.append(out)
        self.assertTrue(any('leased by' in o for o in outputs), outputs)
        # The fastest run is the hook's own cost; the slower ones are other
        # processes taking the CPU, which a median at load 90 is mostly made of.
        base = min(bare_t)
        over_post = min(post_t) - base
        over_pre = min(pre_t) - base
        print(f'\nfastest of 7: startup {base * 1000:.0f} ms, PostToolUse {min(post_t) * 1000:.0f} ms, '
              f'PreToolUse {min(pre_t) * 1000:.0f} ms (hook work {over_post * 1000:.0f} and '
              f'{over_pre * 1000:.0f} ms over startup)', file=sys.stderr)
        self.assertLess(over_post, 0.1, (post_t, bare_t))
        self.assertLess(over_pre, 0.1, (pre_t, bare_t))

    def test_in_process_hook_work_is_small(self):
        post = {'hook_event_name': 'PostToolUse', 'session_id': 'a', 'tool_name': 'Edit',
                'cwd': str(self.repo), 'tool_input': {'file_path': self.target}}
        pre = dict(post, hook_event_name='PreToolUse', session_id='b')
        tabs.handle(pre, 'codex')
        laps = []
        for _ in range(20):
            started = time.perf_counter()
            tabs.handle(post, 'claude-code')
            tabs.handle(pre, 'codex')
            laps.append(time.perf_counter() - started)
        self.assertLess(statistics.median(laps), 0.05, laps)


if __name__ == '__main__':
    unittest.main()
