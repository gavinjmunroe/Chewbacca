"""Offline native-hook regression fixtures; no model calls or user state."""
import json
import shutil
import os
from pathlib import Path
import subprocess
import tempfile
import time
import sys
from unittest.mock import patch
import unittest

ROOT = Path(__file__).resolve().parents[1]


class WriteLogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name).resolve()
        self.repo = self.folder / 'repository'
        self.repo.mkdir()
        self.outside = self.folder / 'projectless'
        self.outside.mkdir()
        self.env = dict(os.environ, HOME=str(self.folder / 'home'),
                        CHEWBACCA_HOME=str(self.folder / 'shared'),
                        CHEWBACCA_SESSION_STATE=str(self.folder / 'state'),
                        CHEWBACCA_WRITE_LOG=str(self.folder / 'custom.tsv'),
                        TMPDIR=str(self.folder))
        self.git('init')
        self.policy = self.repo / 'tests/example_test.py'
        self.policy.parent.mkdir()
        self.policy.write_text('original')
        self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture')

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.repo, env=self.env,
                              capture_output=True, check=True)

    def hook(self, event, cwd=None, data=None, sid='fixture', call=None, tool='functions.exec'):
        payload = {'hook_event_name': event, 'session_id': sid,
                   'tool_name': tool, 'cwd': str(cwd or self.repo),
                   'tool_input': data or {}}
        if call:
            payload['tool_call_id'] = call
        result = subprocess.run(['bash', str(ROOT / '.claude/hooks/write-log.sh')],
                                input=json.dumps(payload), text=True, capture_output=True,
                                cwd=cwd or self.repo, env=self.env, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('unavailable', result.stderr)

    def records(self):
        path = Path(self.env['CHEWBACCA_WRITE_LOG'])
        return path.read_text().splitlines() if path.exists() else []

    def test_dirty_file_content_change_is_logged_without_claiming_baseline(self):
        self.policy.write_text('already dirty')
        self.hook('PreToolUse')
        self.assertEqual(self.records(), [])
        self.policy.write_text('changed again')
        self.hook('PostToolUse')
        self.assertEqual(len(self.records()), 1)
        self.assertEqual(self.records()[0].split('\t')[2], str(self.policy))
        self.hook('PreToolUse')
        self.hook('PostToolUse')
        self.assertEqual(len(self.records()), 1)

    def test_projectless_cwd_uses_explicit_workdir(self):
        data = {'workdir': str(self.repo)}
        self.hook('PreToolUse', self.outside, data)
        self.policy.write_text('actual write')
        self.hook('PostToolUse', self.outside, data)
        self.assertEqual(len(self.records()), 1)

    def test_bash_cd_into_another_repository_is_logged(self):
        # 2026-10-06: `cd ~/second-brain && cat >> ...` from another cwd never
        # reached the log, so brain-sync committed none of a session's notes.
        data = {'command': f'cd {self.repo} && echo more >> tests/example_test.py'}
        self.hook('PreToolUse', self.outside, data, tool='Bash')
        self.policy.write_text('appended through cd')
        self.hook('PostToolUse', self.outside, data, tool='Bash')
        self.assertEqual(len(self.records()), 1)

    def test_context_repository_is_watched_without_a_cd(self):
        self.env['PERSONAL_CONTEXT_DIR'] = str(self.repo)
        data = {'command': 'python3 tools/note.py'}
        self.hook('PreToolUse', self.outside, data, tool='Bash')
        self.policy.write_text('written by a script')
        self.hook('PostToolUse', self.outside, data, tool='Bash')
        self.assertEqual(len(self.records()), 1)

    def test_long_call_claims_nothing_in_an_unnamed_context_repository(self):
        # 2026-10-09: a 10-minute `cd ~ && uv cache prune` was credited with
        # 494 brain files another tab's ingest wrote during it.
        self.env['PERSONAL_CONTEXT_DIR'] = str(self.repo)
        self.env['CHEWBACCA_IMPLICIT_MAX_CALL'] = '0.5'
        data = {'command': 'uv cache prune'}
        self.hook('PreToolUse', self.outside, data, tool='Bash')
        time.sleep(1)
        self.policy.write_text('written by another tab during the call')
        self.hook('PostToolUse', self.outside, data, tool='Bash')
        self.assertEqual(self.records(), [])

    def background(self, *rows):
        path = Path(self.env['CHEWBACCA_HOME']) / 'background-writers.tsv'
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('a') as stream:
            for kind, pid, root in rows:
                stream.write(f'{kind}\t{time.time():.6f}\t{pid}\t{root}\n')

    def test_a_background_jobs_write_during_a_call_is_not_the_calls(self):
        # 2026-10-12: the creator-transcripts job (cwd raw/creators in the
        # brain) wrote transcripts all night, and each one was logged as a
        # write by whichever tab's Bash call was open at that moment.
        self.env['PERSONAL_CONTEXT_DIR'] = str(self.repo)
        creators = self.repo / 'raw/creators'
        creators.mkdir(parents=True)
        self.background(('begin', os.getpid(), str(creators)))  # this test is the live job
        data = {'command': 'ls'}
        self.hook('PreToolUse', self.outside, data, tool='Bash', call='bg-1')
        (creators / '2026-08-27-grok-bot-is-amazing.md').write_text('a transcript')
        self.policy.write_text('the call itself wrote this')
        self.hook('PostToolUse', self.outside, data, tool='Bash', call='bg-1')
        self.assertEqual([r.split('\t')[2] for r in self.records()], [str(self.policy)])

    def test_a_mirror_deletion_inside_a_run_that_ended_is_not_the_calls(self):
        # 2026-10-12 22:38: people-sync's rsync --delete removed a pruned kit
        # snapshot from the brain's mirror of ~/.chewbacca, and 3,111 of the
        # deletions were logged as one togari-tab Bash call's writes.
        self.env['PERSONAL_CONTEXT_DIR'] = str(self.repo)
        mirror = self.repo / 'chewbacca/kit/snapshots/fb5d4a1e'
        mirror.mkdir(parents=True)
        (mirror / 'README.md').write_text('a copy of the kit')
        data = {'command': 'ls'}
        self.hook('PreToolUse', self.outside, data, tool='Bash', call='bg-2')
        self.background(('begin', 99999999, str(self.repo / 'chewbacca')))
        shutil.rmtree(self.repo / 'chewbacca/kit/snapshots')
        self.background(('end', 99999999, str(self.repo / 'chewbacca')))
        self.hook('PostToolUse', self.outside, data, tool='Bash', call='bg-2')
        self.assertEqual(self.records(), [])

    def test_a_background_run_claims_only_its_own_window_and_folder(self):
        self.env['PERSONAL_CONTEXT_DIR'] = str(self.repo)
        (self.repo / 'raw').mkdir()
        # Ended before this call began, and a killed one that never ended.
        path = Path(self.env['CHEWBACCA_HOME']) / 'background-writers.tsv'
        path.parent.mkdir(parents=True)
        path.write_text(f'begin\t{time.time() - 600}\t1\t{self.repo}/raw\n'
                        f'end\t{time.time() - 300}\t1\t{self.repo}/raw\n'
                        f'begin\t{time.time() - 60}\t99999999\t{self.repo}/raw\n')
        data = {'command': 'python3 tools/note.py'}
        self.hook('PreToolUse', self.outside, data, tool='Bash', call='bg-3')
        (self.repo / 'raw/note.md').write_text('the call wrote this')
        self.hook('PostToolUse', self.outside, data, tool='Bash', call='bg-3')
        self.assertEqual([r.split('\t')[2] for r in self.records()], [str(self.repo / 'raw/note.md')])

    def test_background_rows_parse_strictly_and_a_reused_pid_reopens_nothing(self):
        # Review, 10/12: a pid reused after a reboot kept a dead run open,
        # pruning dropped the end that closed it, and rows Python and the
        # binary read differently ('1_0', '+3', a pid past pid_t) split them.
        sys.path.insert(0, str(ROOT / 'tools'))
        self.addCleanup(sys.path.remove, str(ROOT / 'tools'))
        import write_log
        me = os.getpid()
        path = self.folder / 'bg.tsv'
        path.write_text(f'begin\t10.0\t7\t/b/raw\nbegin\t11.0\t8\t/b/x\nend\t20.0\t7\t/b/raw\n'
                        f'begin\t{time.time():.6f}\t{me}\t/b/live\nbegin\t1000\t{me}\t/b/reused\nnoise\n'
                        f'begin\t1_0\t{me}\t/py-only\nbegin\t+3\t{me}\t/rust-only\nbegin\t3\t99999999999\t/too-big\n')
        got = sorted((r, b) for r, b, e in write_log.background_regions(time.time(), path))
        self.assertEqual([r for r, b in got], ['/b/live', '/b/raw'])
        # A prune keeps a closed run's begin and end together, or neither.
        now = time.time() + 10 * 24 * 3600
        kept = write_log._pruned(path.read_text().split('\n'), now)
        self.assertFalse(any('/b/raw' in line for line in kept))
        self.assertTrue(any('/b/live' in line for line in kept))

    def test_the_background_wrapper_marks_its_run_and_passes_the_exit_code(self):
        out = self.repo / 'mirror'
        result = subprocess.run([sys.executable, str(ROOT / 'tools/write_log.py'), 'background',
                                 '--root', str(out), '--', 'sh', '-c', f'mkdir -p {out} && echo x > {out}/f; exit 3'],
                                env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 3, result.stderr)
        rows = (Path(self.env['CHEWBACCA_HOME']) / 'background-writers.tsv').read_text().splitlines()
        self.assertEqual([r.split('\t')[0] for r in rows], ['begin', 'end'])
        self.assertEqual({r.split('\t')[3] for r in rows}, {os.path.realpath(out)})

    def test_context_repository_does_not_claim_files_already_dirty(self):
        self.env['PERSONAL_CONTEXT_DIR'] = str(self.repo)
        self.policy.write_text('another session wrote this earlier')
        data = {'command': 'ls'}
        self.hook('PreToolUse', self.outside, data, tool='Bash')
        self.hook('PostToolUse', self.outside, data, tool='Bash')
        self.assertEqual(self.records(), [])

    def test_unknown_home_in_cd_never_fails_the_call(self):
        data = {'command': 'cd ~nosuchuser_for_this_test && ls'}
        self.hook('PreToolUse', self.outside, data, tool='Bash')
        self.hook('PostToolUse', self.outside, data, tool='Bash')

    def test_cd_on_a_later_line_is_seen(self):
        data = {'command': f'echo start\ncd {self.repo}\necho more >> tests/example_test.py'}
        self.hook('PreToolUse', self.outside, data, tool='Bash')
        self.policy.write_text('appended on line three')
        self.hook('PostToolUse', self.outside, data, tool='Bash')
        self.assertEqual(len(self.records()), 1)

    def test_context_repo_commit_by_another_session_is_not_claimed(self):
        # A long Bash call here while another session's brain-sync commits in
        # the brain must not log that session's files as ours.
        self.env['PERSONAL_CONTEXT_DIR'] = str(self.repo)
        data = {'command': 'sleep 1'}
        self.hook('PreToolUse', self.outside, data, tool='Bash')
        other = self.repo / 'memory.md'
        other.write_text('another session')
        self.git('add', 'memory.md')
        self.git('-c', 'user.name=Other', '-c', 'user.email=o@example.invalid', 'commit', '-m', 'other')
        self.hook('PostToolUse', self.outside, data, tool='Bash')
        self.assertEqual(self.records(), [])

    def test_cd_into_a_hostile_repository_runs_none_of_its_programs(self):
        # Commit security review, 2026-10-06: `cd` targets are now observed, so
        # a cloned repo's fsmonitor or clean filter must never execute.
        hostile = self.folder / 'hostile'
        hostile.mkdir()
        run = lambda *a: subprocess.run(['git', *a], cwd=hostile, env=self.env, capture_output=True, check=True)
        run('init')
        (hostile / 'f.txt').write_text('a')
        run('add', 'f.txt')
        run('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-m', 'x')
        marker = self.folder / 'pwned'
        run('config', 'core.fsmonitor', f'touch {marker}.fsmonitor #')
        run('config', 'filter.evil.clean', f"sh -c 'touch {marker}.filter; cat'")
        (hostile / '.gitattributes').write_text('* filter=evil\n')
        data = {'command': f'cd {hostile} && echo b >> f.txt'}
        self.hook('PreToolUse', self.outside, data, tool='Bash')
        (hostile / 'f.txt').write_text('ab')
        self.hook('PostToolUse', self.outside, data, tool='Bash')
        self.assertEqual(sorted(p.name for p in self.folder.glob('pwned*')), [])
        self.assertEqual(len([r for r in self.records() if r.split('\t')[2].endswith('f.txt')]), 1)

    def test_patch_target_identifies_other_repository(self):
        data = {'input': f'*** Begin Patch\n*** Update File: {self.policy}\n@@\n-x\n+y\n*** End Patch'}
        self.hook('PreToolUse', self.outside, data)
        self.policy.write_text('patched')
        self.hook('PostToolUse', self.outside, data)
        self.assertEqual(len(self.records()), 1)

    def test_first_post_only_observation_claims_nothing(self):
        self.policy.write_text('preexisting')
        self.hook('PostToolUse')
        self.assertEqual(self.records(), [])
        self.policy.write_text('later change')
        self.hook('PostToolUse')
        self.assertEqual(len(self.records()), 1)

    def test_finished_native_call_leaves_no_snapshot(self):
        # 44,065 leftover snapshots filled the disk on 2026-10-09.
        state = Path(self.env['CHEWBACCA_SESSION_STATE'])
        for n in range(3):
            self.hook('PreToolUse', call=f'c{n}')
            self.policy.write_text(f'edit {n}')
            self.hook('PostToolUse', call=f'c{n}')
        self.assertEqual(len(self.records()), 3)
        self.assertEqual(list(state.glob('*.json')), [])

    def test_unchanged_files_reuse_their_digest_and_a_disguised_edit_does_not(self):
        sys.path.insert(0, str(ROOT / 'tools'))
        import write_log
        state = self.folder / 'state'
        state.mkdir()
        log = self.folder / 'custom.tsv'
        self.policy.write_text('dirty one')
        first = write_log.observe(self.repo, log, state)
        with patch.object(write_log, 'fingerprint', side_effect=AssertionError('rehashed')):
            self.assertEqual(write_log.observe(self.repo, log, state), first)
        # Same size, mtime put back: only ctime moves, and that must be enough.
        before = self.policy.stat()
        self.policy.write_text('dirty two')
        os.utime(self.policy, ns=(before.st_atime_ns, before.st_mtime_ns))
        self.assertNotEqual(write_log.observe(self.repo, log, state), first)

    def test_orphaned_snapshot_is_pruned_after_a_day(self):
        state = Path(self.env['CHEWBACCA_SESSION_STATE'])
        self.hook('PreToolUse', call='never-finished')
        orphan = next(state.glob('*.json'))
        old = time.time() - 2 * 86400
        os.utime(orphan, (old, old))
        (state / '.pruned').unlink(missing_ok=True)
        self.hook('PreToolUse', call='next')
        self.assertFalse(orphan.exists())
        self.assertEqual(len(list(state.glob('*.json'))), 1)

    def test_new_file_delete_and_revert_are_changes(self):
        self.hook('PreToolUse')
        new = self.repo / 'tests/new_test.py'
        new.write_text('new')
        self.hook('PostToolUse')
        self.hook('PreToolUse')
        new.unlink()
        self.policy.unlink()
        self.hook('PostToolUse')
        self.assertEqual(len(self.records()), 3)

    def test_actual_guard_uses_custom_log_and_filters_session(self):
        self.hook('PreToolUse')
        self.policy.write_text('durable')
        self.hook('PostToolUse')
        guard = ROOT / '.claude/hooks/durable-guard.sh'
        for sid, expected in [('fixture', 0), ('unrelated', 2)]:
            payload = {'hook_event_name': 'Stop', 'session_id': sid,
                       'prompt_id': sid, 'user_message': 'fix chewbacca'}
            result = subprocess.run(['bash', str(guard)], input=json.dumps(payload),
                                    text=True, capture_output=True, env=self.env, timeout=15)
            self.assertEqual(result.returncode, expected, result.stderr)

    def test_shared_home_default_agrees_between_writer_and_reader(self):
        del self.env['CHEWBACCA_WRITE_LOG']
        self.hook('PreToolUse')
        self.policy.write_text('shared home change')
        self.hook('PostToolUse')
        result = subprocess.run(['python3', str(ROOT / 'bin/durable-check'), '--session', 'fixture'],
                                input='fix chewbacca', text=True, capture_output=True, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((Path(self.env['CHEWBACCA_HOME']) / 'write-log.tsv').is_file())

    def test_denied_call_does_not_reuse_stale_baseline(self):
        self.hook('PreToolUse')
        self.hook('ToolDenied')
        self.policy.write_text('external intervening edit')
        self.hook('PreToolUse')
        self.hook('PostToolUse')
        self.assertEqual(self.records(), [])

    def test_denied_overlap_keeps_other_pending_baseline(self):
        self.hook('PreToolUse')
        self.policy.write_text('real ongoing write')
        self.hook('PreToolUse')
        self.hook('ToolDenied')
        self.hook('PostToolUse')
        self.assertEqual(len(self.records()), 1)

    def test_overlapping_calls_preserve_earlier_write(self):
        for use_ids in (True, False):
            sid = str(use_ids)
            self.hook('PreToolUse', sid=sid, call='a' if use_ids else None)
            self.policy.write_text('changed ' + sid)
            self.hook('PreToolUse', sid=sid, call='b' if use_ids else None)
            self.hook('PostToolUse', sid=sid, call='b' if use_ids else None)
            self.hook('PostToolUse', sid=sid, call='a' if use_ids else None)
            self.assertTrue(any(line.split('\t')[1] == sid for line in self.records()))

    def test_copied_installed_hook_resolves_shared_checkout(self):
        home = Path(self.env['HOME'])
        hooks = home / '.claude/hooks'
        launchers = home / '.local/bin'
        hooks.mkdir(parents=True)
        launchers.mkdir(parents=True)
        (launchers / 'chewbacca').symlink_to(ROOT / 'bin/chewbacca')
        installed = hooks / 'write-log.sh'
        shutil.copyfile(ROOT / '.claude/hooks/write-log.sh', installed)
        env = dict(self.env)
        env.pop('CHEWBACCA_ROOT', None)
        for event in ('PreToolUse', 'PostToolUse'):
            if event == 'PostToolUse':
                self.policy.write_text('installed edit')
            payload = {'hook_event_name': event, 'session_id': 'installed', 'cwd': str(self.repo)}
            result = subprocess.run(['bash', str(installed)], input=json.dumps(payload),
                                    text=True, capture_output=True, cwd=self.outside, env=env, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('unavailable', result.stderr)
        self.assertEqual(len(self.records()), 1)

    def test_edit_and_commit_within_tool_is_logged(self):
        self.hook('PreToolUse')
        self.policy.write_text('committed during tool')
        self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'changed')
        self.hook('PostToolUse')
        self.assertEqual(len(self.records()), 1)
        self.hook('PostToolUse')
        self.assertEqual(len(self.records()), 1)

    def test_command_shaped_patch_has_repository(self):
        data = {'command': f'*** Begin Patch\n*** Update File: {self.policy}\n*** End Patch'}
        self.hook('PreToolUse', self.outside, data)
        self.policy.write_text('command patch')
        self.hook('PostToolUse', self.outside, data)
        self.assertEqual(len(self.records()), 1)

    def test_guard_rejects_earlier_turn_and_accepts_boundary(self):
        boundary = time.time()
        log = Path(self.env['CHEWBACCA_WRITE_LOG'])
        for offset, code in ((-10, 2), (0, 0), (10, 0)):
            log.write_text(f'{boundary + offset}\tfixture\t{self.policy}\n')
            payload = {'hook_event_name': 'Stop', 'session_id': 'fixture',
                       'prompt_id': 'time' + str(offset), 'durable_since': boundary,
                       'user_message': 'fix chewbacca'}
            result = subprocess.run(['bash', str(ROOT / '.claude/hooks/durable-guard.sh')],
                                    input=json.dumps(payload), text=True, capture_output=True,
                                    env=self.env, timeout=15)
            self.assertEqual(result.returncode, code, result.stderr)

    def test_tools_and_instructions_only_qualify_inside_kit(self):
        log = Path(self.env['CHEWBACCA_WRITE_LOG'])
        # Instructions are prose: since 2026-10-11 a correction needs code that
        # runs, or a recorded reason, so an instructions edit alone is refused.
        for name, code in ((ROOT / 'tools/runtime.py', 0), (ROOT / 'config/instructions/agent-neutral.md', 1),
                           (self.outside / 'tools/random.py', 1), (self.outside / 'instructions/note.md', 1)):
            log.write_text(f'{time.time()}\tfixture\t{name}\n')
            result = subprocess.run(['python3', str(ROOT / 'bin/durable-check'), '--session', 'fixture'],
                                    input='fix chewbacca', text=True, capture_output=True, env=self.env)
            self.assertEqual(result.returncode, code, result.stderr)

    def stop_check(self, sid):
        result = subprocess.run(['bash', str(ROOT / '.claude/hooks/stop-check.sh')],
                                input=json.dumps({'hook_event_name': 'Stop', 'session_id': sid}),
                                text=True, capture_output=True, cwd=self.repo, env=self.env, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def test_concurrent_bash_does_not_claim_another_sessions_write(self):
        # 2026-10-03: four extract tabs wrote into ~/second-brain at once. One
        # tab's Bash call was credited with another tab's Write, so stop-check
        # counted that file as the Bash tab's own and warned every turn.
        other = self.repo / 'extracts/02.md'
        other.parent.mkdir()
        self.hook('PreToolUse', sid='bash-tab', call='bash-1', data={'command': 'cat notes'})
        edit = {'file_path': str(other), 'content': 'theirs'}
        self.hook('PreToolUse', sid='write-tab', call='write-1', data=edit, tool='Write')
        other.write_text('theirs')
        self.hook('PostToolUse', sid='write-tab', call='write-1', data=edit, tool='Write')
        self.hook('PostToolUse', sid='bash-tab', call='bash-1', data={'command': 'cat notes'})
        claimed = [line.split('\t')[1] for line in self.records() if line.split('\t')[2] == str(other)]
        self.assertNotIn('bash-tab', claimed)
        self.assertEqual(self.stop_check('bash-tab'), '')
        self.assertIn('uncommitted', self.stop_check('write-tab'))

    def test_reader_credits_exact_write_over_later_bash_row(self):
        # The writer can log the Bash row after the other tab's Write row, so the
        # reader has to apply the same rule to rows already on disk.
        other = self.repo / 'extracts/03.md'
        other.parent.mkdir()
        other.write_text('theirs')
        now = time.time()
        Path(self.env['CHEWBACCA_WRITE_LOG']).write_text(
            f'{now - 5:.6f}\twrite-tab\t{other}\tedit\n'
            f'{now:.6f}\tbash-tab\t{other}\tbash\n')
        self.assertEqual(self.stop_check('bash-tab'), '')
        self.assertIn('uncommitted', self.stop_check('write-tab'))

    def test_reader_treats_legacy_batch_rows_as_bash(self):
        # Old three-column rows still parse. A legacy row written in the same
        # append as rows for other paths came from a diff, so a single-path row
        # from another session outranks it.
        mine, theirs = self.repo / 'a.md', self.repo / 'b.md'
        theirs.write_text('theirs')
        now = time.time()
        Path(self.env['CHEWBACCA_WRITE_LOG']).write_text(
            f'{now - 5:.6f}\twrite-tab\t{theirs}\n'
            f'{now:.6f}\tbash-tab\t{mine}\n'
            f'{now + 0.000013:.6f}\tbash-tab\t{theirs}\n')
        self.assertEqual(self.stop_check('bash-tab'), '')

    def test_codex_prompt_timestamp_resets_and_reaches_guard(self):
        sys.path.insert(0, str(ROOT / 'tools'))
        import codex_hooks
        with patch.dict(os.environ, self.env | {'CODEX_HOME': str(self.folder / 'codex')}):
            for when in (100.25, 200.5):
                with patch.object(codex_hooks.time, 'time', return_value=when):
                    state = codex_hooks.turn_state({'session_id': 'fixture', 'hook_event_name': 'UserPromptSubmit', 'prompt': 'fix chewbacca'})
                self.assertEqual(state['prompt_started_at'], when)
                calls = []
                def capture(name, payload, cwd):
                    if name == 'durable-guard.sh':
                        calls.append(payload.get('durable_since'))
                    return ''
                with patch.object(codex_hooks, 'shared_hook', side_effect=capture), patch.object(codex_hooks, 'git_notice', return_value=''):
                    codex_hooks.dispatch({'session_id': 'fixture', 'turn_id': str(when), 'hook_event_name': 'Stop', 'cwd': str(self.outside)})
                self.assertEqual(calls, [when])


class WriteLogSpeedTests(unittest.TestCase):
    """The hook runs before and after every tool call in every tab."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name).resolve()
        self.repo = self.folder / 'brain'
        self.repo.mkdir()
        subprocess.run(['git', 'init', '-q'], cwd=self.repo, check=True)
        sys.path.insert(0, str(ROOT / 'tools'))
        import write_log
        self.write_log = write_log

    def test_observing_many_dirty_files_stays_cheap(self):
        # 6,000 untracked files, half the brain's 12,119 on 2026-10-11. The
        # pathlib loop cost ~0.18 s of Python CPU here; the string loop ~0.04 s.
        # 0.1 s leaves headroom for a loaded Mac and still fails the old loop.
        for folder in range(60):
            target = self.repo / f'raw/creator-{folder}'
            target.mkdir(parents=True)
            for index in range(100):
                (target / f'{index}.md').write_text('x')
        state = self.folder / 'state'
        state.mkdir()
        log = self.folder / 'log.tsv'
        getattr(self.write_log, 'CONTEXT', set()).clear()
        self.write_log.observe(self.repo, log, state)  # warm the digest cache
        best = None
        for _ in range(3):
            started = time.process_time()
            seen = self.write_log.observe(self.repo, log, state)
            spent = time.process_time() - started
            best = spent if best is None else min(best, spent)
        self.assertEqual(len(seen), 6000)
        self.assertLess(best, 0.1)

    def test_only_context_repos_use_the_builtin_fsmonitor(self):
        calls = []

        def spy(command, *args, **kwargs):
            # Never really start a daemon on a temp dir: record and answer empty.
            calls.append(command)
            return subprocess.CompletedProcess(command, 0, b'', b'')

        other = self.folder / 'other'
        other.mkdir()
        subprocess.run(['git', 'init', '-q'], cwd=other, check=True)
        self.write_log.CONTEXT.clear()
        self.write_log.CONTEXT.add(self.repo)
        with patch.object(self.write_log.subprocess, 'run', side_effect=spy), \
                patch.object(self.write_log.sys, 'platform', 'darwin'):
            self.write_log.git(self.repo, 'status', '--porcelain')
            self.write_log.git(other, 'status', '--porcelain')
        self.write_log.CONTEXT.clear()
        self.assertIn('core.fsmonitor=true', calls[0])
        self.assertIn('core.fsmonitor=false', calls[1])
        self.assertNotIn('core.fsmonitor=true', calls[1])


class WriteLogRuntimeTests(unittest.TestCase):
    """2026-10-11: the Pre ran a shared checkout 87 commits behind, at 1.6 s."""

    def test_setup_registers_the_pre_from_the_installed_copy(self):
        setup = (ROOT / 'setup.sh').read_text()
        self.assertIn('_register("PreToolUse", hooks_dir + "/write-log.sh"', setup)

    def test_the_kit_runtime_wins_over_the_checkout(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            tools = home / '.chewbacca/kit/current/tools'
            tools.mkdir(parents=True)
            marker = home / 'ran-kit'
            (tools / 'write_log.py').write_text('open(%r, "w").close()\n' % str(marker))
            subprocess.run(['bash', str(ROOT / '.claude/hooks/write-log.sh')], input='{}', text=True,
                           capture_output=True, env=dict(os.environ, HOME=str(home)), timeout=30)
            self.assertTrue(marker.exists(), 'write-log.sh ran the checkout, not the kit runtime')


if __name__ == '__main__':
    unittest.main()
