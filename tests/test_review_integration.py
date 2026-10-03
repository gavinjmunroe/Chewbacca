"""Real Git task coverage, with a synthetic reviewer process."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import review_gate as gate


class TaskIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / 'repo'
        self.repo.mkdir()
        env = patch.dict(os.environ, CHEWBACCA_HOME=str(Path(self.temp.name) / 'private'))
        env.start()
        self.addCleanup(env.stop)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        for name in ('index.md', 'unrelated.py'):
            (self.repo / name).write_text('base\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'base')

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo), *args], capture_output=True, check=True).stdout

    def observe(self, before=False):
        gate.observe_task(self.repo, gate.snapshot_manifest(self.repo), before=before)

    def review(self, *, status='reviewed', mutate=None, base=None):
        def complete(command, timeout):
            self.prompt = command[-1]
            Path(command[command.index('--output-last-message') + 1]).write_text(json.dumps(
                {'status': status, 'summary': 'Fixture review', 'findings': []}))
            if mutate:
                mutate()
            return subprocess.CompletedProcess(command, 0, '', '')
        with patch.object(gate.shutil, 'which', return_value=sys.executable), \
                patch.object(gate, 'review_process', side_effect=complete):
            return gate.run_review(self.repo, base=base)

    def test_missing_baseline_cannot_be_recovered_by_explicit_base(self):
        # A repository initialized and committed inside one observed operation
        # has no pre-operation task manifest, although its history is readable.
        with gate.task_review('missing-before'):
            with self.assertRaisesRegex(ValueError, 'pre-operation'):
                self.observe()
            with self.assertRaisesRegex(ValueError, 'without --session-id'):
                self.review(base='UNBORN')
            self.assertTrue(gate.scope_failure_path(self.repo).exists())
            self.assertFalse(gate.task_scope_path(self.repo).exists())
            with self.assertRaisesRegex(ValueError, 'without --session-id'):
                gate.capture_scope(self.repo, 'UNBORN')
            with self.assertRaisesRegex(ValueError, 'explicit recovery'):
                self.observe(before=True)
            self.assertFalse(gate.check(self.repo)[0])
        self.assertTrue(self.review(base='UNBORN')['ok'])
        self.assertEqual(gate.current_scope(self.repo)['base'], 'UNBORN')
        with gate.task_review('missing-before'):
            self.assertTrue(gate.scope_failure_path(self.repo).exists())
            self.assertFalse(gate.check(self.repo)[0])

    def test_missing_manifest_preserves_already_frozen_base(self):
        with gate.task_review('frozen-before'):
            frozen = gate.capture_scope(self.repo, 'UNBORN')
            with self.assertRaisesRegex(ValueError, 'without --session-id'):
                self.review(base='UNBORN')
            self.assertEqual(gate.current_scope(self.repo, allow_failed=True), frozen)
            self.assertTrue(gate.scope_failure_path(self.repo).exists())
            with self.assertRaisesRegex(ValueError, 'explicit recovery'):
                self.observe(before=True)

    def test_two_task_edits_do_not_adopt_old_commit_or_clear_legacy_duty(self):
        legacy_scope = gate.capture_scope(self.repo)
        (self.repo / 'history.py').write_text('old history')
        self.git('add', 'history.py')
        self.git('commit', '-qm', 'unrelated old commit')
        (self.repo / 'unrelated.py').write_text('preexisting dirty\n')
        with gate.task_review('new-task'):
            self.observe(before=True)
            (self.repo / 'index.md').write_text('task edit\n')
            (self.repo / 'second-index.md').write_text('task new\n')
            self.observe()
            coverage = gate.task_evidence(self.repo)
            self.assertEqual(coverage['paths'], ['index.md', 'second-index.md'])
            self.assertEqual(coverage['preexisting_obligations_outside_scope'], ['unrelated.py'])
            self.assertNotEqual(coverage['base'], legacy_scope['base'])
            self.assertTrue(self.review()['ok'])
            self.assertTrue(gate.check(self.repo)[0])
            self.assertIn('TASK-LIMITED', self.prompt)
            self.assertIn('Do not recursively invoke review-gate run', self.prompt)
            self.assertIn('required session preflight', self.prompt)
            self.assertIn('unread or truncated', self.prompt)
        self.assertEqual(gate.current_scope(self.repo), legacy_scope)
        self.assertFalse(gate.check(self.repo)[0])

    def test_task_code_inside_a_new_embedded_repository_needs_its_own_review(self):
        with gate.task_review('embedded-task'):
            self.observe(before=True)
            (self.repo / 'index.md').write_text('task edit\n')
            child = self.repo / 'hidden'
            child.mkdir()
            (child / 'payload.py').write_text('unreviewed task code\n')
            subprocess.run(['git', '-C', str(child), 'init', '-q'], check=True)
            self.observe()
            coverage = gate.task_evidence(self.repo)
            self.assertEqual(gate.embedded_obligations(coverage), ['hidden'])
            self.assertTrue(self.review()['ok'])
            ok, reason = gate.check(self.repo)
            self.assertFalse(ok)
            self.assertIn('hidden', reason)

    def test_untouched_embedded_repository_does_not_block_a_task(self):
        child = self.repo / 'vendor'
        child.mkdir()
        (child / 'lib.py').write_text('preexisting\n')
        subprocess.run(['git', '-C', str(child), 'init', '-q'], check=True)
        with gate.task_review('clean-task'):
            self.observe(before=True)
            (self.repo / 'index.md').write_text('task edit\n')
            self.observe()
            self.assertEqual(gate.embedded_obligations(gate.task_evidence(self.repo)), [])
            self.assertTrue(self.review()['ok'])
            self.assertTrue(gate.check(self.repo)[0])

    def test_touched_dirty_paths_include_preexisting_changes_and_index_only_edits(self):
        (self.repo / 'index.md').write_text('preexisting staged\n')
        self.git('add', 'index.md')
        (self.repo / 'index.md').write_text('base\n')
        with gate.task_review('dirty'):
            self.observe(before=True)
            self.assertIn('index.md', gate.read_task_scope(self.repo)['baseline_dirty'])
            self.git('reset', '-q', 'HEAD', '--', 'index.md')
            self.observe()
            coverage = gate.task_evidence(self.repo)
            self.assertEqual(coverage['paths'], ['index.md'])
            self.assertEqual(coverage['preexisting_changes_in_scope'], ['index.md'])

    def test_concurrent_commit_and_revert_are_both_obligations(self):
        with gate.task_review('concurrent'):
            self.observe(before=True)
            (self.repo / 'unrelated.py').write_text('concurrent\n')
            self.git('add', 'unrelated.py')
            self.git('commit', '-qm', 'concurrent')
            (self.repo / 'unrelated.py').write_text('base\n')
            self.git('add', 'unrelated.py')
            self.git('commit', '-qm', 'revert')
            self.assertEqual(gate.task_evidence(self.repo)['paths'], ['unrelated.py'])
            self.assertTrue(self.review()['ok'])
            self.git('commit', '--allow-empty', '-qm', 'later concurrent commit')
            self.assertFalse(gate.check(self.repo)[0])

    def test_partial_review_and_commit_during_review_never_issue_clean_receipt(self):
        with gate.task_review('partial'):
            self.observe(before=True)
            (self.repo / 'index.md').write_text('task edit\n')
            self.observe()
            self.assertFalse(self.review(status='incomplete')['ok'])
            self.assertFalse(gate.check(self.repo)[0])
            with self.assertRaisesRegex(ValueError, 'changed during review'):
                self.review(mutate=lambda: self.git('commit', '--allow-empty', '-qm', 'race'))
            self.assertFalse(gate.check(self.repo)[0])

    def test_unknown_before_state_and_empty_task_cannot_claim_review(self):
        with gate.task_review('unknown'):
            with self.assertRaisesRegex(ValueError, 'pre-operation'):
                self.observe()
            self.assertTrue(gate.scope_failure_path(self.repo).exists())
            with self.assertRaisesRegex(ValueError, 'explicit recovery'):
                self.observe(before=True)
            self.assertTrue(gate.scope_failure_path(self.repo).exists())
        with gate.task_review('empty'):
            self.observe(before=True)
            with self.assertRaisesRegex(ValueError, 'no observed changes'):
                self.review()
            gate.include_task_paths(self.repo, ['index.md'])
            self.assertTrue(self.review()['ok'])


if __name__ == '__main__':
    unittest.main()
