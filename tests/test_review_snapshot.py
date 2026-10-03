"""Snapshot compatibility and race regressions on real temporary Git repositories."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import review_snapshot as snapshot


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Synthetic')
        self.git('config', 'user.email', 'synthetic@example.invalid')
        (self.repo / 'tracked').write_text('first')
        self.git('add', 'tracked')
        self.git('commit', '-qm', 'fixture')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.PIPE)

    def test_dirty_content_and_index_are_bound(self):
        first = snapshot.snapshot(self.repo)
        (self.repo / 'tracked').write_text('other')
        dirty = snapshot.snapshot(self.repo)
        self.assertNotEqual(first, dirty)
        self.git('add', 'tracked')
        staged = snapshot.snapshot(self.repo)
        self.assertNotEqual(dirty, staged)
        (self.repo / 'untracked').write_text('new')
        self.assertNotEqual(staged, snapshot.snapshot(self.repo))
        details = snapshot.snapshot_details(self.repo)
        self.assertEqual(details['index_entries']['tracked'][0][0], '100644')

    def test_ignored_file_is_outside_contract(self):
        (self.repo / '.gitignore').write_text('ignored\n')
        first = snapshot.snapshot(self.repo)
        (self.repo / 'ignored').write_text('ignored content')
        self.assertEqual(first, snapshot.snapshot(self.repo))

    def test_deleted_file_mode_and_symlink_target_are_bound(self):
        path = self.repo / 'tracked'
        first = snapshot.snapshot(self.repo)
        path.chmod(0o755)
        executable = snapshot.snapshot(self.repo)
        self.assertNotEqual(first, executable)
        path.unlink()
        deleted = snapshot.snapshot(self.repo)
        self.assertNotEqual(executable, deleted)
        path.symlink_to('target-a')
        link = snapshot.snapshot(self.repo)
        path.unlink()
        path.symlink_to('target-b')
        self.assertNotEqual(link, snapshot.snapshot(self.repo))

    def test_unborn_head(self):
        fresh = Path(self.temp.name) / 'unborn'
        subprocess.check_call(['git', 'init', '-q', str(fresh)])
        (fresh / 'new').write_text('content')
        self.assertEqual(snapshot.snapshot_manifest(fresh)['state']['head'], 'UNBORN')

    def test_parent_tracked_file_inside_child_remains_bound(self):
        child = self.repo / 'child'
        child.mkdir()
        tracked = child / 'parent-owned'
        tracked.write_text('parent version')
        self.git('add', 'child/parent-owned')
        subprocess.check_call(['git', 'init', '-q', str(child)])
        first = snapshot.snapshot(self.repo)
        tracked.write_text('changed parent file')
        self.assertNotEqual(first, snapshot.snapshot(self.repo))

    def test_no_metadata_cache_can_hide_same_size_edit(self):
        first = snapshot.snapshot(self.repo)
        path = self.repo / 'tracked'
        info = path.stat()
        path.write_text('other')
        os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns))
        self.assertNotEqual(first, snapshot.snapshot(self.repo))

    def test_child_boundary_excludes_contents_and_removal_invalidates(self):
        child = self.repo / 'child'
        subprocess.check_call(['git', 'init', '-q', str(child)])
        (child / 'file').write_text('one')
        first = snapshot.snapshot(self.repo)
        self.assertEqual(snapshot.repository_files(self.repo)[1], {b'child/'})
        (child / 'file').write_text('two')
        self.assertEqual(first, snapshot.snapshot(self.repo))
        shutil.rmtree(child / '.git')
        self.assertNotEqual(first, snapshot.snapshot(self.repo))

    def test_linked_worktree_boundary(self):
        child = self.repo / 'linked'
        self.git('worktree', 'add', '--detach', str(child))
        self.assertIn(b'linked/', snapshot.repository_files(self.repo)[1])
        first = snapshot.snapshot(self.repo)
        (child / 'tracked').write_text('child edit')
        self.assertEqual(first, snapshot.snapshot(self.repo))

    def test_gitlink_rejected(self):
        self.git('update-index', '--add', '--cacheinfo',
                 '160000,' + self.git('rev-parse', 'HEAD').decode().strip() + ',child')
        (self.repo / 'child').mkdir()
        with self.assertRaisesRegex(ValueError, 'separate review scope'):
            snapshot.snapshot(self.repo)

    def test_absent_gitlink_rejected_from_index(self):
        self.git('update-index', '--add', '--cacheinfo',
                 '160000,' + self.git('rev-parse', 'HEAD').decode().strip() + ',child')
        self.assertFalse((self.repo / 'child').exists())
        with self.assertRaisesRegex(ValueError, 'separate review scope'):
            snapshot.snapshot(self.repo)

    def test_gitlink_replaced_by_file_rejected_from_index(self):
        self.git('update-index', '--add', '--cacheinfo',
                 '160000,' + self.git('rev-parse', 'HEAD').decode().strip() + ',child')
        (self.repo / 'child').write_text('replacement')
        with self.assertRaisesRegex(ValueError, 'separate review scope'):
            snapshot.snapshot(self.repo)

    def test_serial_and_parallel_manifests_match(self):
        (self.repo / 'new\nfile').write_bytes(b'\0data')
        (self.repo / 'link').symlink_to('tracked')
        self.assertEqual(snapshot.snapshot_manifest(self.repo, workers=1),
                         snapshot.snapshot_manifest(self.repo, workers=4))

    def test_concurrent_commit_rejected(self):
        original = snapshot.file_entry
        def commit(*args):
            result = original(*args)
            self.git('commit', '--allow-empty', '-qm', 'concurrent')
            return result
        with patch.object(snapshot, 'file_entry', side_effect=commit):
            with self.assertRaisesRegex(ValueError, 'state changed'):
                snapshot.snapshot(self.repo)

    def test_concurrent_index_change_rejected(self):
        original = snapshot.file_entry
        def stage(*args):
            result = original(*args)
            self.git('update-index', '--chmod=+x', 'tracked')
            return result
        with patch.object(snapshot, 'file_entry', side_effect=stage):
            with self.assertRaisesRegex(ValueError, 'state changed'):
                snapshot.snapshot(self.repo)

    def test_new_file_during_snapshot_rejected(self):
        original = snapshot.file_entry
        def create(*args):
            result = original(*args)
            (self.repo / 'new').write_text('concurrent')
            return result
        with patch.object(snapshot, 'file_entry', side_effect=create):
            with self.assertRaisesRegex(ValueError, 'state changed'):
                snapshot.snapshot(self.repo)

    def test_edit_after_hash_rejected(self):
        original = snapshot.file_entry
        def edit(*args):
            result = original(*args)
            (self.repo / 'tracked').write_text('after')
            return result
        with patch.object(snapshot, 'file_entry', side_effect=edit):
            with self.assertRaisesRegex(ValueError, 'file changed'):
                snapshot.snapshot(self.repo)

    def test_unmerged_index_rejected(self):
        oid = self.git('rev-parse', 'HEAD:tracked').strip()
        subprocess.run(['git', '-C', str(self.repo), 'update-index', '--index-info'],
                       input=b'0 ' + b'0' * 40 + b'\ttracked\n100644 ' + oid + b' 1\ttracked\n', check=True)
        with self.assertRaisesRegex(ValueError, 'unmerged'):
            snapshot.snapshot(self.repo)


if __name__ == '__main__':
    unittest.main()
