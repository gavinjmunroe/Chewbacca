import subprocess
import sys
from pathlib import Path
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import review_task_scope as scope


class TaskScopeTests(unittest.TestCase):
    def manifest(self, **files):
        return {'state': {'repo': '/task', 'head': 'baseline'},
                'files': [[name, 'file', 420, value] for name, value in sorted(files.items())]}

    def test_dirty_baseline_does_not_expand_two_index_edits_to_old_commit(self):
        before = self.manifest(index='old', second_index='old', other='preexisting')
        task = scope.new_scope('/task', 'session', before, ['index', 'other'])
        after = self.manifest(index='new', second_index='new', other='preexisting')
        task = scope.observe_scope(task, after)
        evidence = scope.scope_evidence(task, after)
        self.assertEqual(evidence['paths'], ['index', 'second_index'])
        self.assertEqual(evidence['preexisting_changes_in_scope'], ['index'])
        self.assertEqual(evidence['preexisting_obligations_outside_scope'], ['other'])
        self.assertFalse(evidence['repository_wide_clean'])

    def test_reverted_observed_changes_remain_in_scope(self):
        before = self.manifest(file='old')
        task = scope.new_scope('/task', 'session', before)
        task = scope.observe_scope(task, self.manifest(file='new'))
        task = scope.observe_scope(task, before)
        self.assertEqual(scope.scope_evidence(task, before)['paths'], ['file'])

    def test_unknown_post_only_observation_stays_incomplete(self):
        before = self.manifest(file='old')
        task = scope.new_scope('/task', 'session', before)
        task = scope.observe_scope(task, before, ['file'], pre_observed=False)
        self.assertEqual(scope.scope_evidence(task, before)['errors'],
                         ['missing pre-operation observation'])

    def test_child_contents_never_become_parent_coverage(self):
        before = self.manifest(file='old')
        before['files'].append(['child/', 'separate_repository', 493])
        task = scope.new_scope('/task', 'session', before)
        task = scope.observe_scope(task, before, ['child/file', 'file'])
        evidence = scope.scope_evidence(task, before)
        self.assertEqual(evidence['paths'], ['file'])
        self.assertEqual(evidence['separate_repository_obligations'], ['child/file'])

    def test_index_only_changes_are_in_scope(self):
        before = self.manifest(file='same')
        before['index_entries'] = {'file': [['100644', 'old', '0']]}
        task = scope.new_scope('/task', 'session', before)
        after = self.manifest(file='same')
        after['index_entries'] = {'file': [['100644', 'new', '0']]}
        task = scope.observe_scope(task, after)
        self.assertEqual(scope.scope_evidence(task, after)['paths'], ['file'])

    def test_removed_child_boundary_does_not_exclude_new_parent_files(self):
        before = self.manifest()
        before['files'].append(['child/', 'separate_repository', 493])
        task = scope.new_scope('/task', 'session', before)
        after = self.manifest(**{'child/file': 'new'})
        task = scope.observe_scope(task, after)
        evidence = scope.scope_evidence(task, after)
        self.assertIn('child/file', evidence['paths'])
        self.assertEqual(evidence['separate_repositories'], [])

    def test_baseline_is_not_mutated_and_other_repo_is_rejected(self):
        before = self.manifest(file='old')
        task = scope.new_scope('/task', 'session', before)
        before['files'][0][-1] = 'new'
        self.assertEqual(task['baseline']['files'][0][-1], 'old')
        before['state']['repo'] = '/other'
        with self.assertRaises(ValueError):
            scope.observe_scope(task, before)

    def test_concurrent_commits_and_cancelled_changes_are_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], stderr=subprocess.DEVNULL).decode().strip()
            git('init')
            git('config', 'user.email', 'test@example.invalid')
            git('config', 'user.name', 'Test')
            (repo / 'file').write_text('old')
            git('add', 'file')
            git('commit', '-m', 'baseline')
            base = git('rev-parse', 'HEAD')
            (repo / '\nfile').write_text('newline name')
            git('add', '--', '\nfile')
            (repo / 'file').write_text('new')
            git('commit', '-am', 'concurrent')
            (repo / 'file').write_text('old')
            git('commit', '-am', 'cancel')
            self.assertEqual(scope.history_paths(repo, base, git('rev-parse', 'HEAD')), ['\nfile', 'file'])
            with self.assertRaises(ValueError):
                scope.history_paths(repo, git('rev-parse', 'HEAD'), base)


if __name__ == '__main__':
    unittest.main()
