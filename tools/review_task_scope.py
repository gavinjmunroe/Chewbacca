"""Conservative task review evidence; this module never creates clean receipts.

A task baseline does not retire older repository-wide review obligations. Files
already dirty at capture stay explicit obligations, including their preexisting
changes when the task touches the same path. Snapshot manifests come from
review_gate.snapshot_manifest so hooks need only one filesystem/hash pass.
"""
from copy import deepcopy
from pathlib import Path, PurePosixPath
import subprocess


def _path(name):
    if not isinstance(name, str) or not name or '\0' in name:
        raise ValueError('invalid review path')
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '.' == name:
        raise ValueError('review paths must be repository relative')
    return name


def _files(manifest):
    if not isinstance(manifest, dict) or not isinstance(manifest.get('state'), dict):
        raise ValueError('invalid review manifest')
    if not isinstance(manifest['state'].get('head'), str):
        raise ValueError('manifest HEAD is missing')
    result = {}
    if not isinstance(manifest.get('files'), list):
        raise ValueError('manifest files are missing')
    for entry in manifest['files']:
        if not isinstance(entry, list) or len(entry) < 2:
            raise ValueError('invalid manifest entry')
        name = _path(entry[0])
        if name in result:
            raise ValueError('duplicate manifest path')
        result[name] = entry[1:]
    return result


def new_scope(repo, task_id, manifest, dirty_paths=()):
    """Capture before the first observed operation, retaining dirty provenance."""
    if not isinstance(task_id, str) or not task_id:
        raise ValueError('task identity is required')
    _files(manifest)
    root = str(Path(repo).resolve())
    if manifest['state'].get('repo') != root:
        raise ValueError('manifest belongs to another repository')
    return {'version': 1, 'repo': root, 'task_id': task_id,
            'baseline': deepcopy(manifest), 'latest': deepcopy(manifest),
            'baseline_dirty': sorted({_path(path) for path in dirty_paths}),
            'observed_paths': [], 'errors': []}


def _validate(scope, manifest):
    if not isinstance(scope, dict) or scope.get('version') != 1:
        raise ValueError('invalid task scope')
    if manifest['state'].get('repo') != scope['repo']:
        raise ValueError('manifest belongs to another repository')
    _files(scope['baseline'])
    _files(scope['latest'])
    _files(manifest)


def observe_scope(scope, manifest, touched_paths=(), *, pre_observed=True):
    """Accumulate every observed change, even when a later edit cancels it.

    Call after an operation with pre_observed=False if its before-state was not
    captured. Such evidence cannot support a clean scoped review on its own.
    """
    _validate(scope, manifest)
    result = deepcopy(scope)
    previous, current = _files(scope['latest']), _files(manifest)
    changed = {path for path in previous.keys() | current.keys()
               if previous.get(path) != current.get(path)}
    before_index = scope['latest'].get('index_entries')
    after_index = manifest.get('index_entries')
    if before_index is not None and after_index is not None:
        changed |= {_path(path) for path in before_index.keys() | after_index.keys()
                    if before_index.get(path) != after_index.get(path)}
    elif scope['latest']['state'].get('index') != manifest['state'].get('index'):
        if 'missing per-path index observation' not in result['errors']:
            result['errors'].append('missing per-path index observation')
    result['observed_paths'] = sorted(set(scope['observed_paths']) | changed |
                                      {_path(path) for path in touched_paths})
    if not pre_observed and 'missing pre-operation observation' not in result['errors']:
        result['errors'].append('missing pre-operation observation')
    result['latest'] = deepcopy(manifest)
    return result


def history_paths(repo, base, current):
    """Union paths over every intervening commit, including cancelling patches.

    Divergence is not treated as an empty diff. Merges compare every parent so
    changes brought in on another branch remain review obligations.
    """
    def git(*args):
        result = subprocess.run(['git', '-C', str(repo), *args],
                                capture_output=True, timeout=30)
        if result.returncode:
            raise ValueError('cannot establish continuous task commit history')
        return result.stdout

    if base == current:
        return []
    if current == 'UNBORN':
        raise ValueError('task repository lost its commit history')
    if base != 'UNBORN':
        git('merge-base', '--is-ancestor', base, current)
    revision = current if base == 'UNBORN' else base + '..' + current
    names = git('log', '--format=', '--name-only', '-z', '--no-renames',
                '--root', '-m', revision, '--').split(b'\0')
    return sorted({_path(name.decode('utf-8', 'surrogateescape'))
                   for name in names if name})


def scope_evidence(scope, manifest, history_paths=None):
    """Return explicit limited coverage and preserved preexisting obligations."""
    _validate(scope, manifest)
    current = _files(manifest)
    baseline = _files(scope['baseline'])
    if history_paths is None:
        if scope['baseline']['state']['head'] != manifest['state']['head']:
            raise ValueError('changed HEAD requires commit history evidence')
        history_paths = ()
    paths = set(scope['observed_paths']) | {_path(path) for path in history_paths}
    paths |= {path for path in baseline.keys() | current.keys()
              if baseline.get(path) != current.get(path)}
    before_index = scope['baseline'].get('index_entries', {})
    after_index = manifest.get('index_entries', {})
    paths |= {_path(path) for path in before_index.keys() | after_index.keys()
              if before_index.get(path) != after_index.get(path)}
    boundaries = {path for path, value in current.items()
                  if value[0] == 'separate_repository'}
    excluded = {path for path in paths if any(path == boundary or
                path.startswith(boundary.rstrip('/') + '/') for boundary in boundaries)}
    paths -= excluded
    dirty = set(scope['baseline_dirty'])
    return {'kind': 'task', 'task_id': scope['task_id'], 'repo': scope['repo'],
            'base': scope['baseline']['state']['head'],
            'head': manifest['state']['head'], 'paths': sorted(paths),
            'preexisting_changes_in_scope': sorted(paths & dirty),
            'preexisting_obligations_outside_scope': sorted(dirty - paths),
            'separate_repositories': sorted(boundaries),
            'separate_repository_obligations': sorted(excluded),
            'errors': list(scope['errors']),
            'repository_wide_clean': False}
