"""Codex's wire format must actually reach the shared checks."""
import json
from functools import wraps
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import codex_hooks as hooks


def task_review_test(session_id):
    def decorate(function):
        @wraps(function)
        def run(*args, **kwargs):
            import review_gate
            with review_gate.task_review(session_id):
                return function(*args, **kwargs)
        return run
    return decorate


class HookTests(unittest.TestCase):
    def setUp(self):
        self.state_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.state_directory.cleanup)
        private_review = patch.dict(os.environ, {'CHEWBACCA_HOME': str(Path(self.state_directory.name) / 'private')})
        private_review.start()
        self.addCleanup(private_review.stop)
        self.state_patch = patch.object(hooks.context, 'codex_home', return_value=Path(self.state_directory.name))
        self.state_patch.start()
        self.addCleanup(self.state_patch.stop)

    def diagnostics(self):
        directory = hooks.context.codex_home() / 'chewbacca-hook-diagnostics'
        paths = list(directory.glob('*.json'))
        self.assertTrue(paths, 'raw hook diagnostics must be retained privately')
        for path in paths:
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        return '\n'.join(path.read_text() for path in paths)

    def test_desktop_stop_and_retry_emit_no_completion_rewrite(self):
        import review_gate
        home = hooks.context.codex_home()
        transcript = home / 'desktop.jsonl'
        transcript.write_text(json.dumps({'type': 'session_meta', 'payload': {
            'id': 'desktop', 'originator': 'Codex Desktop'}}) + '\n')
        payload = {'session_id': 'desktop', 'turn_id': 'turn',
                   'hook_event_name': 'Stop', 'cwd': str(home),
                   'transcript_path': str(transcript),
                   'last_assistant_message': 'The review remains incomplete.'}
        hooks.turn_state(dict(payload, hook_event_name='ReviewScopeFailed', review_repo='/pending'))
        with patch.object(hooks, 'review_stop', return_value='PRIVATE REVIEW DIAGNOSTIC') as review:
            self.assertEqual(hooks.dispatch(payload), {})
            self.assertEqual(hooks.dispatch(dict(payload, stop_hook_active=True)), {})
            self.assertEqual(review.call_count, 1)
        self.assertIn('PRIVATE REVIEW DIAGNOSTIC', self.diagnostics())
        self.assertEqual(hooks.turn_state(payload)['review_required'], ['/pending'])
        with review_gate.task_review('desktop'):
            self.assertFalse(review_gate.receipt_path('/pending').exists())

    def test_removed_native_hook_does_not_dispatch_or_write_receipt(self):
        import io
        home = hooks.context.codex_home()
        (home / 'hooks.json').write_text(json.dumps({'hooks': {'Stop': [
            {'hooks': [{'type': 'command', 'command': 'other-hook'}]}]}}))
        with patch.object(sys, 'argv', ['codex_hooks.py', 'run']), \
             patch.object(sys, 'stdin', io.StringIO(json.dumps({'hook_event_name': 'Stop'}))), \
             patch.object(hooks, 'dispatch') as dispatch, \
             patch('sys.stdout', new_callable=io.StringIO) as output:
            hooks.main()
        dispatch.assert_not_called()
        self.assertEqual(output.getvalue(), '')
        self.assertFalse((home / 'chewbacca-hook-status.json').exists())

    def test_registration_is_specific_to_adapter_and_event(self):
        home = hooks.context.codex_home()
        self.assertFalse(hooks.registered_for_event(home, 'Stop'))
        hooks.install(home)
        self.assertTrue(hooks.registered_for_event(home, 'Stop'))
        data = json.loads((home / 'hooks.json').read_text())
        data['hooks']['Stop'] = []
        (home / 'hooks.json').write_text(json.dumps(data))
        self.assertFalse(hooks.registered_for_event(home, 'Stop'))
        self.assertTrue(hooks.registered_for_event(home, 'UserPromptSubmit'))

    def test_failed_event_is_audited_without_private_payload(self):
        import io
        home = hooks.context.codex_home()
        hooks.install(home)
        payload = {'hook_event_name': 'Stop', 'session_id': 'audit-test',
                   'last_assistant_message': 'PRIVATE_REPLY'}
        with patch.object(sys, 'argv', ['codex_hooks.py', 'run']), \
             patch.object(sys, 'stdin', io.StringIO(json.dumps(payload))), \
             patch.object(hooks, 'dispatch', side_effect=ValueError('PRIVATE_ERROR')):
            with self.assertRaises(RuntimeError) as raised:
                hooks.main()
            self.assertNotIn('PRIVATE_ERROR', str(raised.exception))
        hooks.audit_event({'hook_event_name': 'PreToolUse'}, 'ok')
        saved = (home / 'chewbacca-hook-events' / 'Stop.json').read_text()
        self.assertEqual(json.loads(saved)['status'], 'error')
        self.assertNotIn('PRIVATE', saved)

    def test_main_error_preserves_pretool_denial_without_raw_diagnostic(self):
        import io
        home = hooks.context.codex_home()
        hooks.install(home)
        payload = {'hook_event_name': 'PreToolUse', 'session_id': 'failed-check'}
        with patch.object(sys, 'argv', ['codex_hooks.py', 'run']), \
             patch.object(sys, 'stdin', io.StringIO(json.dumps(payload))), \
             patch.object(hooks, 'dispatch', side_effect=ValueError('PRIVATE_EXCEPTION')), \
             patch('sys.stdout', new_callable=io.StringIO) as output:
            hooks.main()
        value = json.loads(output.getvalue())
        self.assertEqual(value['hookSpecificOutput']['permissionDecision'], 'deny')
        self.assertNotIn('PRIVATE_EXCEPTION', output.getvalue())
        self.assertIn('PRIVATE_EXCEPTION', self.diagnostics())

    def test_main_desktop_stop_error_does_not_emit_retry_or_raw_output(self):
        import io
        home = hooks.context.codex_home()
        hooks.install(home)
        transcript = home / 'desktop-error.jsonl'
        transcript.write_text(json.dumps({'type': 'session_meta', 'payload': {
            'id': 'desktop-error', 'originator': 'Codex Desktop'}}) + '\n')
        payload = {'hook_event_name': 'Stop', 'session_id': 'desktop-error',
                   'transcript_path': str(transcript)}
        with patch.object(sys, 'argv', ['codex_hooks.py', 'run']), \
             patch.object(sys, 'stdin', io.StringIO(json.dumps(payload))), \
             patch.object(hooks, 'dispatch', side_effect=ValueError('PRIVATE_STOP_EXCEPTION')), \
             patch('sys.stdout', new_callable=io.StringIO) as output:
            hooks.main()
        self.assertEqual(output.getvalue(), '')
        self.assertIn('PRIVATE_STOP_EXCEPTION', self.diagnostics())

    def test_review_observes_real_repository_writes_across_tool_shapes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            repo, outside = root / 'repo with spaces', root / 'outside'
            repo.mkdir()
            outside.mkdir()
            subprocess.run(['git', 'init', '-q', str(repo)], check=True, capture_output=True)
            subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Test',
                            '-c', 'user.email=test@example.invalid', 'commit',
                            '--allow-empty', '-qm', 'init'], check=True, capture_output=True)
            existing = repo / 'existing.py'
            existing.write_text('value = 0\n')
            new_file = repo / 'new directory' / 'new.py'
            cases = [
                ('workdir', 'exec_command', {'workdir': str(repo), 'cmd': 'write'}, existing),
                ('absolute_patch', 'apply_patch',
                 {'command': f'*** Update File: {existing}\n+value = 1'}, existing),
                ('new_directory', 'apply_patch',
                 {'command': f'*** Add File: {new_file}\n+value = 1'}, new_file),
                ('formatter', 'apply_patch',
                 {'command': f'*** Update File: {existing}\n+value = 1'}, existing),
                ('absolute_shell', 'exec_command',
                 {'cmd': f'echo changed > "{existing}"'}, existing),
                ('nested_exec', 'functions.exec', {'code':
                 'await tools.exec_command(' + json.dumps({'workdir': str(repo), 'cmd': 'write'}) + ')'}, existing),
            ]
            for index, (name, tool, tool_input, target) in enumerate(cases, 1):
                with self.subTest(name=name), patch.object(hooks, 'shared_hook', return_value=''), \
                        patch.object(hooks, 'invoke', return_value=''):
                    base = {'session_id': name, 'cwd': str(outside), 'tool_name': tool,
                            'tool_input': tool_input, 'tool_use_id': name}
                    hooks.dispatch(dict(base, hook_event_name='PreToolUse'))

                    def mutate(*_):
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_text(f'value = {index}\n')

                    if name != 'formatter':
                        mutate()
                    with patch.object(hooks, 'format_file', side_effect=mutate if name == 'formatter' else None):
                        hooks.dispatch(dict(base, hook_event_name='PostToolUse'))
                    state = hooks.turn_state(dict(base, hook_event_name='Stop'))
                    self.assertEqual(state['review_required'], [str(repo)])

    def test_post_failure_still_accounts_for_final_bytes_once(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp).resolve()
            subprocess.run(['git', 'init', '-q', str(repo)], check=True, capture_output=True)
            target = repo / 'code.py'
            target.write_text('original\n')
            for stage in ('formatter', 'post_hook'):
                with self.subTest(stage=stage):
                    base = {'session_id': stage, 'cwd': str(repo), 'tool_name': 'Edit',
                            'tool_use_id': stage, 'tool_input': {'file_path': str(target)}}
                    with patch.object(hooks, 'shared_hook', return_value=''):
                        hooks.dispatch(dict(base, hook_event_name='PreToolUse'))
                    target.write_text('tool changed ' + stage + '\n')
                    def formatter(*args):
                        if stage == 'formatter':
                            target.write_text('formatter changed bytes then failed\n')
                            raise ValueError('malformed formatter output')
                    def shared(name, *args):
                        if stage == 'post_hook':
                            raise RuntimeError('post hook failed')
                        return ''
                    with patch.object(hooks, 'format_file', side_effect=formatter), \
                            patch.object(hooks, 'shared_hook', side_effect=shared), \
                            patch.object(hooks, 'invoke', return_value=''):
                        with self.assertRaises((ValueError, RuntimeError)):
                            hooks.dispatch(dict(base, hook_event_name='PostToolUse'))
                    state = hooks.turn_state(dict(base, hook_event_name='Stop'))
                    self.assertEqual(state['sequence'], 1)
                    self.assertEqual(state['review_required'], [str(repo)])
                    self.assertEqual(state['review_before'], {})
                    self.assertEqual(state['review_inflight'], {})

    @task_review_test('new-repo')
    def test_repository_initialized_inside_tool_creates_review_obligation(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp).resolve()
            base = {'session_id': 'new-repo', 'cwd': str(repo), 'tool_name': 'exec_command',
                    'tool_use_id': 'init-and-write', 'tool_input': {'cmd': 'git init and write'}}
            with patch.object(hooks, 'shared_hook', return_value=''):
                hooks.dispatch(dict(base, hook_event_name='PreToolUse'))
                subprocess.run(['git', 'init', '-q', str(repo)], check=True, capture_output=True)
                (repo / 'new.py').write_text('new repository content\n')
                hooks.dispatch(dict(base, hook_event_name='PostToolUse'))
            state = hooks.turn_state(dict(base, hook_event_name='Stop'))
            self.assertEqual(state['review_required'], [str(repo)])
            self.assertEqual(state['sequence'], 1)
            import review_gate
            with self.assertRaises(ValueError):
                review_gate.current_scope(repo)
            self.assertTrue(review_gate.scope_failure_path(repo).exists())

    @task_review_test('scope-failure')
    def test_pre_scope_failure_keeps_obligation_and_allows_repair(self):
        import review_gate
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp).resolve()
            subprocess.run(['git', 'init', '-q', str(repo)], check=True, capture_output=True)
            payload = {'session_id': 'scope-failure', 'hook_event_name': 'PreToolUse',
                       'cwd': str(repo), 'tool_name': 'exec_command', 'tool_use_id': 'scope',
                       'tool_input': {'cmd': 'write'}}
            with patch.object(review_gate, 'capture_scope', side_effect=OSError('disk full')), \
                    patch.object(hooks, 'shared_hook', return_value=''):
                result = hooks.dispatch(payload)
            self.assertNotEqual(result.get('hookSpecificOutput', {}).get('permissionDecision'), 'deny')
            state = hooks.turn_state(dict(payload, hook_event_name='Stop'))
            self.assertEqual(state['review_required'], [str(repo)])
            with patch.object(hooks, 'shared_hook', return_value=''):
                repair = dict(payload, tool_use_id='repair')
                result = hooks.dispatch(repair)
                self.assertNotEqual(result.get('hookSpecificOutput', {}).get('permissionDecision'), 'deny')
                with self.assertRaises(review_gate.TaskBaselineUnavailable):
                    review_gate.capture_scope(repo, base='UNBORN')
                with review_gate.task_review(None):
                    self.assertEqual(review_gate.capture_scope(repo, base='UNBORN')['base'], 'UNBORN')
                hooks.dispatch(dict(repair, hook_event_name='PostToolUse'))
            self.assertEqual(hooks.turn_state(dict(payload, hook_event_name='Stop'))['review_required'], [str(repo)])

    @task_review_test('post-scope-failure')
    def test_post_scope_failure_keeps_obligation_and_records_sentinel(self):
        import review_gate
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp).resolve()
            base = {'session_id': 'post-scope-failure', 'cwd': str(repo),
                    'tool_name': 'exec_command', 'tool_use_id': 'init', 'tool_input': {'cmd': 'init'}}
            with patch.object(hooks, 'shared_hook', return_value=''):
                hooks.dispatch(dict(base, hook_event_name='PreToolUse'))
                subprocess.run(['git', 'init', '-q', str(repo)], check=True, capture_output=True)
                with patch.object(review_gate, 'capture_scope', side_effect=OSError('scope write failed')):
                    hooks.dispatch(dict(base, hook_event_name='PostToolUse'))
            state = hooks.turn_state(dict(base, hook_event_name='Stop'))
            self.assertEqual(state['review_required'], [str(repo)])
            with self.assertRaises(ValueError):
                review_gate.capture_scope(repo)
            with self.assertRaises(review_gate.TaskBaselineUnavailable):
                review_gate.capture_scope(repo, base='UNBORN')
            self.assertTrue(review_gate.scope_failure_path(repo).exists())
            self.assertFalse(review_gate.task_scope_path(repo).exists())
            with review_gate.task_review(None):
                self.assertEqual(review_gate.capture_scope(repo, base='UNBORN')['base'], 'UNBORN')
            self.assertTrue(review_gate.scope_failure_path(repo).exists())

    def test_review_keeps_baseline_for_overlapping_identical_calls(self):
        for identity in ({}, {'tool_use_id': 'duplicate'}):
            with self.subTest(identity=identity):
                base = {'session_id': 'overlap-' + str(identity),
                        'cwd': self.state_directory.name, 'tool_name': 'exec_command',
                        'tool_input': {'cmd': 'same'}, **identity}
                observations = [{'/repo': 'before'}, {'/repo': 'before'},
                                {'/repo': 'before'}, {'/repo': 'after'}]
                with patch.object(hooks, 'review_snapshots', side_effect=observations):
                    for event in ('PreToolUse', 'PreToolUse', 'PostToolUse', 'PostToolUse'):
                        state = hooks.turn_state(dict(base, hook_event_name=event))
                self.assertEqual(state['review_required'], ['/repo'])

    def test_review_keeps_earliest_baseline_when_second_call_starts_after_write(self):
        base = {'session_id': 'overlap-after-write', 'cwd': self.state_directory.name,
                'tool_name': 'exec_command', 'tool_input': {'cmd': 'same'}}
        observations = [{'/repo': 'before'}, {'/repo': 'after'},
                        {'/repo': 'after'}, {'/repo': 'after'}]
        with patch.object(hooks, 'review_snapshots', side_effect=observations):
            for event in ('PreToolUse', 'PreToolUse', 'PostToolUse', 'PostToolUse'):
                state = hooks.turn_state(dict(base, hook_event_name=event))
        self.assertEqual(state['review_required'], ['/repo'])

    def test_literal_reads_do_not_capture_unrelated_unavailable_repositories(self):
        import review_gate
        for command in ('cat /unrelated/repo/README.md', 'ls /unrelated/repo',
                        'rg --no-config TODO /unrelated/repo', 'pwd\nwc -l /unrelated/repo/README.md'):
            with self.subTest(command=command), \
                    patch.object(review_gate, 'snapshot', side_effect=ValueError('unavailable')) as snapshot, \
                    patch.object(review_gate, 'capture_scope') as capture, \
                    patch.object(hooks, 'shared_hook', return_value='') as shared:
                payload = {'session_id': command, 'cwd': self.state_directory.name,
                           'tool_name': 'Bash', 'tool_input': {'command': command}}
                hooks.dispatch(dict(payload, hook_event_name='PreToolUse'))
                hooks.dispatch(dict(payload, hook_event_name='PostToolUse'))
                state = hooks.turn_state(dict(payload, hook_event_name='Stop'))
                self.assertEqual(state['review_required'], [])
                self.assertEqual(state.get('last_write', 0), 0)
                snapshot.assert_not_called()
                capture.assert_not_called()
                self.assertIn('submit-guard.sh', [call.args[0] for call in shared.call_args_list])

    def test_relative_child_shell_writes_keep_child_review_obligations(self):
        import subprocess
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory).resolve()
            child = parent / 'child#literal'
            child.mkdir()
            for root in (parent, child):
                subprocess.run(['git', 'init', '-q', str(root)], check=True)
            target = child / 'code.py'
            for index, (cwd, workdir, command) in enumerate((
                    (parent, None, 'printf changed > child#literal/code.py'),
                    (parent, None, 'printf changed >child#literal/code.py'),
                    (parent, None, 'printf changed >>child#literal/code.py'),
                    (parent, None, 'cd child#literal && printf changed > code.py'),
                    (parent, None, 'cd child#literal; printf changed >code.py'),
                    (parent.parent, parent.name, 'printf changed > child#literal/code.py'),
                    (parent.parent, str(parent), 'printf changed > child#literal/code.py'))):
                with self.subTest(command=command, workdir=workdir):
                    target.write_text('before')
                    tool_input = {'cmd': command}
                    if workdir is not None:
                        tool_input['workdir'] = workdir
                    payload = {'session_id': 'relative-child-' + str(index), 'cwd': str(cwd),
                               'tool_name': 'exec_command', 'tool_input': tool_input}
                    hooks.turn_state(dict(payload, hook_event_name='PreToolUse'))
                    subprocess.run(command, shell=True, cwd=parent, check=True)
                    state = hooks.turn_state(dict(payload, hook_event_name='PostToolUse'))
                    self.assertIn(str(child), state['review_required'])

    def test_shell_execution_and_redirects_are_not_classified_as_reads(self):
        for command in ('cat a > b', 'cat $(touch b)', 'cat `touch b`',
                        'cat a; touch b', 'cat a\ntouch b', 'cat a | tee b',
                        'rg --no-config --pre=writer pattern a', 'rg pattern a',
                        'rg --no-config --hostname-bin=./writer --hyperlink-format=file --color=always pattern a',
                        'rg --no-config --hostname-bin ./writer pattern a',
                        'rg --no-config -nz pattern a', 'rg -- --no-config',
                        'rg -e --no-config pattern', 'python3 reader.py', 'cat "unterminated'):
            with self.subTest(command=command):
                self.assertFalse(hooks.literal_read_only({'tool_name': 'Bash',
                                                         'tool_input': {'command': command}}))

    def test_unavailable_snapshot_preserves_guards_and_review_obligation(self):
        import review_gate
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp).resolve()
            subprocess.run(['git', 'init', '-q', str(repo)], check=True, capture_output=True)
            base = {'session_id': 'unavailable', 'cwd': str(repo),
                    'tool_name': 'exec_command', 'tool_input': {'cmd': 'read'}}
            with patch.object(review_gate, 'snapshot_manifest', side_effect=ValueError('unmerged index')), \
                    patch.object(hooks, 'shared_hook', return_value='') as shared:
                hooks.dispatch(dict(base, hook_event_name='PreToolUse'))
                self.assertIn('submit-guard.sh', [call.args[0] for call in shared.call_args_list])
                hooks.dispatch(dict(base, hook_event_name='PostToolUse'))
            state = hooks.turn_state(dict(base, hook_event_name='UserPromptSubmit', prompt='Continue'))
            self.assertEqual(state['review_required'], [str(repo)])
            with patch.object(review_gate, 'check', return_value=(False, 'snapshot unavailable')):
                result = hooks.dispatch(dict(base, hook_event_name='Stop', stop_hook_active=False))
            self.assertNotIn('decision', result)
            self.assertEqual(hooks.turn_state(dict(base, hook_event_name='Stop'))['review_required'], [str(repo)])

    def test_old_review_duties_do_not_reopen_on_later_read_only_turns(self):
        import review_gate
        base = {'session_id': 'quiet-followups', 'cwd': self.state_directory.name}
        hooks.turn_state(dict(base, hook_event_name='UserPromptSubmit', prompt='Fix it'))
        hooks.turn_state(dict(base, hook_event_name='ReviewScopeFailed', review_repo='/pending'))
        with patch.object(review_gate, 'check', return_value=(False, 'missing review')) as check, \
                patch.object(hooks, 'shared_hook', return_value=''), \
                patch.object(hooks, 'git_notice', return_value=''):
            self.assertEqual(hooks.dispatch(dict(base, hook_event_name='Stop'))['decision'], 'block')
            for prompt in ('Thanks', 'Peace', 'Can I build in another tab?', 'Show the status'):
                hooks.turn_state(dict(base, hook_event_name='UserPromptSubmit', prompt=prompt))
                tool = dict(base, tool_name='Bash', tool_input={'command': 'pwd'},
                            tool_response={'exit_code': 0})
                hooks.turn_state(dict(tool, hook_event_name='PreToolUse'))
                hooks.turn_state(dict(tool, hook_event_name='PostToolUse'))
                check.reset_mock()
                self.assertEqual(hooks.dispatch(dict(base, hook_event_name='Stop')), {})
                check.assert_not_called()
                self.assertEqual(hooks.turn_state(dict(base, hook_event_name='Stop'))['review_required'], ['/pending'])
            with patch.object(hooks, 'review_snapshots', return_value={}):
                hooks.turn_state(dict(base, hook_event_name='PostToolUse', tool_name='apply_patch'))
            self.assertEqual(hooks.dispatch(dict(base, hook_event_name='Stop'))['decision'], 'block')
            check.assert_called()

    def test_review_tracks_parallel_tools_and_survives_next_prompt(self):
        base = {'session_id': 'review-test', 'cwd': self.state_directory.name}
        hooks.turn_state(dict(base, hook_event_name='UserPromptSubmit', prompt='Fix it'))
        with patch.object(hooks, 'review_snapshots', return_value={'/repo-a': 'before-a'}):
            hooks.turn_state(dict(base, hook_event_name='PreToolUse', tool_use_id='a'))
        with patch.object(hooks, 'review_snapshots', return_value={'/repo-b': 'before-b'}):
            hooks.turn_state(dict(base, hook_event_name='PreToolUse', tool_use_id='b'))
        with patch.object(hooks, 'review_snapshots', return_value={'/repo-a': 'after-a'}):
            hooks.turn_state(dict(base, hook_event_name='PostToolUse', tool_use_id='a'))
        with patch.object(hooks, 'review_snapshots', return_value={'/repo-b': 'before-b'}):
            hooks.turn_state(dict(base, hook_event_name='PostToolUse', tool_use_id='b'))
        state = hooks.turn_state(dict(base, hook_event_name='UserPromptSubmit', prompt='Continue'))
        self.assertEqual(state['review_required'], ['/repo-a'])

    @task_review_test('s')
    def test_stop_accepts_only_bound_incomplete_report_and_preserves_obligations(self):
        import review_gate
        with tempfile.TemporaryDirectory() as temp, \
                patch.dict(os.environ, {'CHEWBACCA_HOME': temp}), \
                patch.object(review_gate, 'snapshot', return_value='fixture-snapshot'), \
                patch.object(review_gate, 'check', return_value=(False, 'no clean review')), \
                patch.object(hooks, 'shared_hook', return_value=''), \
                patch.object(hooks, 'git_notice', return_value=''):
            repo = Path(temp).resolve() / 'repo'
            repo.mkdir()
            review_gate.failed_outcome(repo, 'fixture-snapshot', 'incomplete',
                                       {'status': 'incomplete', 'summary': 'Missing callers', 'findings': []})
            state = {'review_required': [str(repo)], 'sequence': 2, 'last_write': 1}
            base = {'hook_event_name': 'Stop', 'session_id': 's', 'turn_id': 't',
                    'cwd': str(repo), 'stop_hook_active': False}
            with patch.object(hooks, 'turn_state', return_value=state):
                rejected = hooks.dispatch(dict(base, last_assistant_message='Complete and ready.'))
                self.assertEqual(rejected['decision'], 'block')
                prepared = json.loads(review_gate.disposition_path('s', 't').read_text())
                self.assertNotIn('Missing callers', rejected['reason'])
                self.assertNotIn('decision', hooks.dispatch(dict(base, last_assistant_message=prepared['report'])))
                self.assertNotIn('decision', hooks.dispatch(dict(base, last_assistant_message=
                    review_gate.INCOMPLETE_PRAYER + '\n\n' + prepared['report'])))
                self.assertEqual(state['review_required'], [str(repo)])
                self.assertFalse(review_gate.receipt_path(repo).exists())
                self.assertEqual(hooks.dispatch(dict(base, turn_id='next', last_assistant_message=prepared['report']))['decision'], 'block')
                self.assertNotIn('decision', hooks.dispatch(dict(base, last_assistant_message='Review remains pending.')))
                self.assertFalse(review_gate.check(repo)[0])

    @task_review_test('s')
    def test_unavailable_snapshot_report_survives_reporting_tool_post_event(self):
        import review_gate
        with tempfile.TemporaryDirectory() as temp, \
                patch.dict(os.environ, {'CHEWBACCA_HOME': temp}), \
                patch.object(review_gate, 'snapshot', side_effect=ValueError('unmerged')), \
                patch.object(review_gate, 'check', return_value=(False, 'snapshot unavailable')), \
                patch.object(hooks, 'shared_hook', return_value=''), \
                patch.object(hooks, 'git_notice', return_value=''):
            repo = Path(temp).resolve() / 'repo'
            repo.mkdir()
            review_gate.failed_outcome(repo, None, 'snapshot_unavailable')
            prepared = review_gate.prepare_incomplete([repo], 's', 't', 4)
            state = {'review_required': [str(repo)], 'sequence': 5, 'last_write': 1}
            payload = {'hook_event_name': 'Stop', 'session_id': 's', 'turn_id': 't',
                       'cwd': str(repo), 'stop_hook_active': False, 'last_assistant_message': prepared['report']}
            with patch.object(hooks, 'turn_state', return_value=state):
                self.assertEqual(hooks.dispatch(payload)['decision'], 'block')
                self.assertNotIn('decision', hooks.dispatch(payload))
                self.assertEqual(state['review_required'], [str(repo)])
                self.assertFalse(review_gate.receipt_path(repo).exists())

    def test_review_retry_ends_without_review_or_clearing_duties(self):
        payload = {'hook_event_name': 'Stop', 'cwd': self.state_directory.name,
                   'session_id': 'cancel', 'stop_hook_active': True}
        hooks.turn_state(dict(payload, hook_event_name='ReviewScopeFailed', review_repo='/pending'))
        with patch.object(hooks, 'review_stop') as review, patch.object(hooks, 'shared_hook') as shared:
            result = hooks.dispatch(payload)
        self.assertNotIn('decision', result)
        review.assert_not_called()
        shared.assert_not_called()
        self.assertEqual(hooks.turn_state(payload)['review_required'], ['/pending'])
        state = hooks.turn_state(dict(payload, hook_event_name='UserPromptSubmit', prompt='Continue'))
        self.assertEqual(state['review_required'], ['/pending'])

    def test_explicit_cancellation_ends_first_stop_without_review(self):
        payload = {'hook_event_name': 'Stop', 'cwd': self.state_directory.name, 'session_id': 'cancel'}
        for prompt in ('Bro stop', 'Stop.', 'Please stop working', 'Cancel this task'):
            hooks.turn_state(dict(payload, hook_event_name='UserPromptSubmit', prompt=prompt))
            hooks.turn_state(dict(payload, hook_event_name='ReviewScopeFailed', review_repo='/pending'))
            with patch.object(hooks, 'review_stop') as review:
                self.assertNotIn('decision', hooks.dispatch(payload))
                review.assert_not_called()
            self.assertEqual(hooks.turn_state(payload)['review_required'], ['/pending'])
        for prompt in ('Fix the stop hook', 'Do not stop', 'Stop the loop and keep working'):
            hooks.turn_state(dict(payload, hook_event_name='UserPromptSubmit', prompt=prompt))
            with patch.object(hooks, 'review_stop', return_value='Review missing'):
                self.assertEqual(hooks.dispatch(payload)['decision'], 'block')

    def test_verification_guard_uses_completed_success_after_patch(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'HOME': temp, 'TMPDIR': temp}):
            base = {'session_id': 'evidence-test', 'cwd': temp}
            hooks.turn_state(dict(base, hook_event_name='UserPromptSubmit', prompt='Check the change'))
            hooks.turn_state(dict(base, hook_event_name='PostToolUse', tool_name='apply_patch'))
            hooks.turn_state(dict(base, hook_event_name='PostToolUse', tool_name='Bash',
                                  tool_response={'exit_code': 1}))
            stop = dict(base, hook_event_name='Stop', turn_id='failure', last_assistant_message='It works now')
            self.assertEqual(hooks.dispatch(stop)['decision'], 'block')
            self.assertIn('vibe-guard', self.diagnostics())
            hooks.turn_state(dict(base, hook_event_name='PostToolUse', tool_name='Bash',
                                  tool_response={'exit_code': 0}))
            self.assertEqual(hooks.dispatch(dict(stop, turn_id='success')), {})
            hooks.turn_state(dict(base, hook_event_name='PostToolUse', tool_name='apply_patch'))
            self.assertEqual(hooks.dispatch(dict(stop, turn_id='edited-again'))['decision'], 'block')

    def test_parallel_receipts_are_not_lost(self):
        with hooks.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: hooks.turn_state({'session_id': 'parallel',
                          'hook_event_name': 'PostToolUse', 'tool_name': 'Bash',
                          'cwd': self.state_directory.name,
                          'tool_response': {'exit_code': 0}}), range(12)))
        state = hooks.turn_state({'session_id': 'parallel', 'hook_event_name': 'Stop'})
        self.assertEqual(state['sequence'], 12)
        self.assertEqual(state['last_success'], 12)

    def test_shell_write_does_not_verify_itself(self):
        base = {'session_id': 'shell-write', 'cwd': self.state_directory.name,
                'tool_name': 'exec_command', 'tool_input': {'cmd': 'edit'},
                'tool_response': {'exit_code': 0}}
        hooks.turn_state(dict(base, hook_event_name='UserPromptSubmit', prompt='Fix this'))
        with patch.object(hooks, 'review_snapshots', side_effect=[
                {'/repo': 'before'}, {'/repo': 'after'},
                {'/repo': 'after'}, {'/repo': 'after'}]):
            hooks.turn_state(dict(base, hook_event_name='PreToolUse'))
            state = hooks.turn_state(dict(base, hook_event_name='PostToolUse'))
            self.assertEqual(state['last_write'], 1)
            self.assertEqual(state['last_success'], -1)
            hooks.turn_state(dict(base, hook_event_name='PreToolUse'))
            state = hooks.turn_state(dict(base, hook_event_name='PostToolUse'))
            self.assertEqual(state['last_success'], 2)

    def test_error_response_is_not_verification(self):
        for response in ({'exit_code': 0, 'isError': True},
                         {'exit_code': 0, 'error': 'failed'},
                         {'exit_code': 1}, {'session_id': 123}):
            with self.subTest(response=response):
                state = hooks.turn_state({'session_id': str(response),
                    'hook_event_name': 'PostToolUse', 'cwd': self.state_directory.name,
                    'tool_name': 'exec_command', 'tool_response': response})
                self.assertNotIn('last_success', state)

    def test_native_shell_status_comes_from_host_metadata_not_stdout(self):
        for code in (0, 1, None):
            with self.subTest(code=code), \
                    patch.object(hooks, 'native_exit_code', return_value=code):
                state = hooks.turn_state({'session_id': 'native-' + str(code),
                    'hook_event_name': 'PostToolUse', 'cwd': self.state_directory.name,
                    'tool_name': 'Bash', 'tool_response': 'Process exited with code 0'})
                self.assertEqual(state.get('last_success'), 1 if code == 0 else None)

    def test_prompt_routes_to_real_skill_in_fresh_install(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'HOME': temp}):
            result = hooks.dispatch({'hook_event_name': 'UserPromptSubmit', 'cwd': temp,
                                     'prompt': 'Why is my build failing with a null pointer error?'})
            self.assertIn('debugging', result['hookSpecificOutput']['additionalContext'])

    def test_patch_content_reaches_both_prewrite_guards_after_rename(self):
        payload = {'hook_event_name': 'PreToolUse', 'cwd': '/tmp', 'tool_name': 'apply_patch',
                   'tool_input': {'command': '*** Begin Patch\n*** Update File: old.md\n'
                       '*** Move to: new name.md\n@@\n-old\n+New Person\n*** End Patch'}}
        with patch.object(hooks, 'shared_hook', return_value='') as run:
            hooks.dispatch(payload)
        calls = [c for c in run.call_args_list if c.args[0] in ('fusion-guard.sh', 'ux-guard.sh')]
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertEqual(call.args[1]['tool_input']['new_string'], 'New Person')
            self.assertEqual(call.args[1]['tool_input']['file_path'], str(Path('/tmp/new name.md').resolve()))

    def test_write_log_records_real_change_from_shell(self):
        import subprocess
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {
                'HOME': temp, 'CHEWBACCA_WRITE_LOG': temp + '/writes.tsv',
                'CHEWBACCA_SESSION_STATE': temp + '/state'}):
            repo = Path(temp).resolve() / 'repo'
            repo.mkdir()
            subprocess.run(['git', 'init', '-q', str(repo)], check=True)
            payload = {'hook_event_name': 'PreToolUse', 'tool_name': 'Bash',
                       'tool_input': {'command': 'a local file edit'},
                       'cwd': str(repo), 'session_id': 'writer-test'}
            hooks.dispatch(payload)
            (repo / 'new.txt').write_text('hello')
            hooks.dispatch(dict(payload, hook_event_name='PostToolUse'))
            self.assertIn('writer-test\t' + str((repo / 'new.txt').resolve()),
                          (Path(temp) / 'writes.tsv').read_text())

    def test_real_handoff_guard_blocks_manual_command_handoff(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'HOME': temp, 'TMPDIR': temp}):
            payload = {'hook_event_name': 'Stop', 'cwd': temp, 'session_id': 'handoff-test',
                       'turn_id': 'one', 'last_assistant_message':
                       'Run this command in your terminal: npm test'}
            result = hooks.dispatch(payload)
            self.assertEqual(result['decision'], 'block')
            self.assertNotIn('handoff-guard', result['reason'])
            self.assertIn('handoff', self.diagnostics().lower())

    def test_shell_submission_is_denied_without_running_the_command(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'HOME': temp}):
            for name in ('Bash', 'exec_command', 'functions.exec'):
                payload = {'hook_event_name': 'PreToolUse', 'cwd': temp,
                           'tool_name': name, 'tool_input': {
                               'command': 'curl -X POST https://brightspace.example.invalid/dropbox'}}
                result = hooks.dispatch(payload)['hookSpecificOutput']
                self.assertEqual(result['permissionDecision'], 'deny')
                self.assertNotIn('coursework submission', result['permissionDecisionReason'])
                self.assertIn('coursework submission', self.diagnostics())
            payload['tool_input']['command'] = 'curl -f https://brightspace.example.invalid/status'
            self.assertEqual(hooks.dispatch(payload), {})

    def test_pretool_matcher_covers_shell_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            path = hooks.install(Path(temp))
            group = json.loads(path.read_text())['hooks']['PreToolUse'][-1]
            self.assertNotIn('matcher', group)

    def test_structured_denial_survives_translation(self):
        from subprocess import CompletedProcess
        denied = {'hookSpecificOutput': {'permissionDecision': 'deny',
                                         'permissionDecisionReason': 'Test refusal'}}
        response = CompletedProcess([], 0, json.dumps(denied), '')
        with patch.object(hooks.subprocess, 'run', return_value=response):
            with self.assertRaises(hooks.HookDenied):
                hooks.invoke(['guard'], {'hook_event_name': 'PreToolUse'}, '/tmp')

    def test_fresh_install_reply_guard_uses_bundled_scanners(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'HOME': temp}):
            payload = {'hook_event_name': 'Stop', 'cwd': temp, 'session_id': 'test',
                       'turn_id': 'test', 'last_assistant_message':
                       'In conclusion, let us delve into this robust tapestry. '
                       'It is not about X, it is about Y.'}
            result = hooks.dispatch(payload)
            self.assertEqual(result['decision'], 'block')
            payload['stop_hook_active'] = True
            self.assertEqual(hooks.dispatch(payload), {})

    def test_install_keeps_other_hooks_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            path = home / 'hooks.json'
            other = {'type': 'command', 'command': 'existing-app-hook'}
            path.write_text(json.dumps({'hooks': {'Stop': [{'hooks': [other]}]}}))
            hooks.install(home)
            first = path.read_text()
            hooks.install(home)
            self.assertEqual(path.read_text(), first)
            self.assertEqual(json.loads(first)['hooks']['Stop'][0]['hooks'], [other])
            self.assertEqual(len(json.loads(first)['hooks']), 5)
            self.assertNotIn('PRIVATE_CANARY', first)
            self.assertTrue((home / 'hooks.json.before-chewbacca').is_file())

    def test_symlink_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            target = home / 'dotfiles.json'
            target.write_text('{}')
            (home / 'hooks.json').symlink_to(target)
            hooks.install(home)
            self.assertTrue((home / 'hooks.json').is_symlink())
            self.assertIn('SessionStart', target.read_text())

    def test_patch_all_files_including_rename_and_spaces(self):
        payload = {'cwd': '/tmp', 'tool_name': 'apply_patch', 'tool_input': {'command':
                   '*** Begin Patch\n*** Add File: one.md\n+x\n*** Update File: two.md\n'
                   '*** Move to: new name.md\n@@\n-x\n+y\n*** Delete File: old.md\n*** End Patch'}}
        paths = hooks.changed_paths(payload)
        self.assertEqual([Path(p).name for p in paths], ['one.md', 'two.md', 'new name.md', 'old.md'])
        payload['tool_name'] = 'Bash'
        self.assertEqual(hooks.changed_paths(payload), [])

    def test_post_checks_every_existing_file(self):
        with tempfile.TemporaryDirectory() as temp:
            for name in ('one.md', 'two.md'):
                (Path(temp) / name).write_text('hello')
            payload = {'cwd': temp, 'hook_event_name': 'PostToolUse', 'tool_name': 'apply_patch',
                       'tool_input': {'command': '*** Add File: one.md\n*** Add File: two.md\n*** Delete File: gone.md'}}
            with patch.object(hooks, 'format_file') as fmt, patch.object(hooks, 'shared_hook', return_value='checked') as run:
                out = hooks.dispatch(payload)
            self.assertEqual(fmt.call_count, 2)
            self.assertEqual(run.call_count, 2)
            self.assertEqual(out['hookSpecificOutput']['hookEventName'], 'PostToolUse')
            self.assertTrue(all('file_path' in call.args[1]['tool_input'] for call in run.call_args_list))

    def test_env_patch_reaches_guard_before_write(self):
        payload = {'cwd': '/tmp', 'hook_event_name': 'PreToolUse', 'tool_name': 'apply_patch',
                   'tool_input': {'command': '*** Add File: .env'}}
        with patch.object(hooks, 'shared_hook', return_value='check secrets') as run:
            context = hooks.dispatch(payload)['hookSpecificOutput']['additionalContext']
            self.assertNotIn('check secrets', context)
            self.assertIn('check secrets', self.diagnostics())
            self.assertEqual(run.call_args_list[0].args[0], 'env-guard.sh')
            self.assertEqual(Path(run.call_args_list[0].args[1]['tool_input']['file_path']).name, '.env')

    def test_stop_feedback_uses_codex_contract_and_no_loop(self):
        payload = {'cwd': '/tmp', 'hook_event_name': 'Stop', 'session_id': 'session', 'turn_id': 'first'}
        with patch.object(hooks, 'shared_hook', side_effect=lambda name, *_: 'Rewrite plainly' if name == 'slop-guard.sh' else '') as run, patch.object(hooks, 'git_notice', return_value=''):
            response = hooks.dispatch(payload)
            self.assertEqual(response['decision'], 'block')
            self.assertNotIn('Rewrite plainly', response['reason'])
            self.assertIn('Rewrite plainly', self.diagnostics())
            first_id = run.call_args.args[1]['prompt_id']
            payload['turn_id'] = 'second'
            hooks.dispatch(payload)
            self.assertNotEqual(run.call_args.args[1]['prompt_id'], first_id)
            run.reset_mock()
            payload['stop_hook_active'] = True
            self.assertEqual(hooks.dispatch(payload), {})
            run.assert_not_called()

    def test_stop_feedback_cannot_replace_the_actual_user_prompt(self):
        base = {'session_id': 'prompt-provenance', 'cwd': self.state_directory.name}
        hooks.turn_state(dict(base, hook_event_name='UserPromptSubmit',
                              prompt='Are the hooks still broken?'))
        with patch.object(hooks, 'shared_hook', return_value='') as run, \
             patch.object(hooks, 'git_notice', return_value=''):
            hooks.dispatch(dict(base, hook_event_name='Stop', turn_id='first',
                user_message='fix chewbacca', last_assistant_message='Checks remain pending.'))
        self.assertTrue(run.called)
        for call in run.call_args_list:
            self.assertEqual(call.args[1]['user_message'], 'Are the hooks still broken?')

    def test_startup_fresh_context_on_compaction(self):
        with tempfile.TemporaryDirectory() as temp:
            brain = Path(temp)
            for name in hooks.context.SOURCES:
                path = brain / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('PRIVATE_CANARY')
            with patch.object(hooks.context, 'brain_root', return_value=brain):
                payload = {'hook_event_name': 'SessionStart', 'source': 'compact', 'cwd': temp}
                first = hooks.dispatch(payload)['hookSpecificOutput']['additionalContext']
                self.assertEqual(first.count('PRIVATE_CANARY'), 5)
                (brain / hooks.context.SOURCES[0]).write_text('UPDATED_CANARY')
                self.assertIn('UPDATED_CANARY', hooks.dispatch(payload)['hookSpecificOutput']['additionalContext'])

    def test_literal_prompt_only_never_executes_settings(self):
        import shlex
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'HOME': temp}):
            directory = Path(temp) / '.claude'
            directory.mkdir()
            literal = {'hookSpecificOutput': {'hookEventName': 'UserPromptSubmit', 'additionalContext': 'Personal opener'}}
            config = {'hooks': {'UserPromptSubmit': [{'hooks': [
                {'command': 'printf %s ' + shlex.quote(json.dumps(literal))},
                {'command': 'touch /tmp/MUST_NOT_RUN'},
            ]}]}}
            (directory / 'settings.json').write_text(json.dumps(config))
            with patch.object(hooks.subprocess, 'run') as run:
                self.assertEqual(hooks.prompt_context(), 'Personal opener')
                run.assert_not_called()

    def test_legacy_stop_json_is_translated(self):
        result = type('Result', (), {'returncode': 0, 'stderr': '', 'stdout': json.dumps({
            'hookSpecificOutput': {'hookEventName': 'Stop', 'continueLoop': True,
                                   'systemMessage': 'Rewrite reply'}})})()
        with patch.object(hooks.subprocess, 'run', return_value=result):
            self.assertEqual(hooks.invoke(['bash', 'guard.sh'], {}, '/tmp'), 'Rewrite reply')


if __name__ == '__main__':
    unittest.main()
