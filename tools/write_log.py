#!/usr/bin/env python3
"""Observe repository byte changes for shared hooks; this is not authenticated authorship."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time


def git(repo, *args):
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, timeout=5)
    if result.returncode:
        raise ValueError('repository observation unavailable')
    return result.stdout


# Tools whose payload names the file they wrote. Their rows are exact; every
# other changed path is inferred from a before/after diff of the whole tree and
# is tagged "bash", because a diff cannot tell this session's write from another
# live session's write that landed inside the same window.
EXACT_TOOLS = {'Write', 'Edit', 'MultiEdit', 'NotebookEdit'}
PATCH_PREFIXES = ('*** Add File: ', '*** Update File: ', '*** Delete File: ', '*** Move to: ')
# A file changed by the command has an mtime inside the call, give or take
# filesystem timestamp granularity. Guessed, never measured: 2s covers HFS+
# one-second mtimes with room to spare.
MTIME_SLACK = 2.0


def exact_targets(payload):
    """Paths this call named itself: a file-edit tool's target or a patch's files."""
    cwd = Path(payload.get('cwd') or os.getcwd())
    data = payload.get('tool_input') or {}
    data = data if isinstance(data, dict) else {}
    targets = set()
    if payload.get('tool_name') in EXACT_TOOLS:
        for field in ('file_path', 'notebook_path'):
            if isinstance(data.get(field), str):
                targets.add(str((cwd / data[field]).resolve()))
    patch = data.get('patch') or data.get('input') or data.get('command')
    if isinstance(patch, str):
        for line in patch.splitlines():
            for prefix in PATCH_PREFIXES:
                if line.startswith(prefix):
                    targets.add(str((cwd / line[len(prefix):]).resolve()))
    return targets


def others_exact(log, sid, since):
    """Paths another session logged as an exact edit at or after `since`."""
    claimed = set()
    try:
        with open(log, encoding='utf-8', errors='ignore') as stream:
            for line in stream:
                parts = line.rstrip('\n').split('\t')
                if len(parts) < 4 or parts[3] != 'edit' or parts[1] == sid:
                    continue
                try:
                    if float(parts[0]) >= since:
                        claimed.add(parts[2])
                except ValueError:
                    continue
    except FileNotFoundError:
        pass
    return claimed


def touched_in_window(path, start, end):
    try:
        modified = Path(path).lstat().st_mtime
    except FileNotFoundError:
        return True  # A deletion has no mtime left to check.
    return start - MTIME_SLACK <= modified <= end + MTIME_SLACK


def repositories(payload):
    cwd = Path(payload.get('cwd') or os.getcwd()).resolve()
    data = payload.get('tool_input') or {}
    data = data if isinstance(data, dict) else {}
    candidates = [cwd]
    if isinstance(data.get('workdir'), str):
        candidates.append(cwd / data['workdir'])
    for field in ('file_path', 'path'):
        if isinstance(data.get(field), str):
            candidates.append((cwd / data[field]).parent)
    patch = data.get('patch') or data.get('input') or data.get('command')
    if isinstance(patch, str):
        for line in patch.splitlines():
            for prefix in PATCH_PREFIXES:
                if line.startswith(prefix):
                    candidates.append((cwd / line[len(prefix):]).parent)
    found = set()
    for candidate in candidates:
        while not candidate.is_dir() and candidate != candidate.parent:
            candidate = candidate.parent
        result = subprocess.run(['git', '-C', str(candidate), 'rev-parse', '--show-toplevel'],
                                capture_output=True, timeout=5)
        if result.returncode == 0:
            found.add(Path(os.fsdecode(result.stdout).strip()).resolve())
    return sorted(found)


def head(repo):
    result = subprocess.run(['git', '-C', str(repo), 'rev-parse', '--verify', 'HEAD'],
                            capture_output=True, timeout=5)
    return result.stdout.decode().strip() if result.returncode == 0 else None


def committed_paths(repo, previous, current):
    if current is None or previous == current:
        return set()
    args = ('diff', '--name-only', '-z', previous, current) if previous else ('ls-tree', '-r', '--name-only', '-z', current)
    return {str(repo / os.fsdecode(name)) for name in git(repo, *args).split(b'\0')
            if name and not any(char in name for char in (b'\t', b'\r', b'\n'))}


def fingerprint(path):
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return 'missing'
    if stat.S_ISLNK(metadata.st_mode):
        return 'link:' + os.readlink(path)
    if not stat.S_ISREG(metadata.st_mode):
        return 'special:' + str(metadata.st_mode)
    digest = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError('file changed type during observation')
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return str(stat.S_IMODE(metadata.st_mode)) + ':' + digest.hexdigest()


def observe(repo, log, state):
    names = set()
    for args in (('diff', '--name-only', '-z'), ('diff', '--cached', '--name-only', '-z'),
                 ('ls-files', '--others', '--exclude-standard', '-z')):
        names.update(os.fsdecode(name) for name in git(repo, *args).split(b'\0') if name)
    result = {}
    for name in names:
        path = repo / name
        if any(character in str(path) for character in '\t\r\n'):
            continue  # Legacy TSV cannot represent these paths unambiguously.
        if path == log or path == log.with_suffix(log.suffix + '.lock') or state == path or state in path.parents:
            continue
        if '.chewbacca' in path.parts:
            continue
        result[str(path)] = fingerprint(path)
    return result


def save(path, document):
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.write-log-')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(document, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def record(payload):
    sid = payload.get('session_id')
    if not isinstance(sid, str) or not sid or any(c in sid for c in '\t\r\n'):
        return
    home = Path(os.environ.get('CHEWBACCA_HOME') or Path.home() / '.chewbacca').expanduser()
    log = Path(os.environ.get('CHEWBACCA_WRITE_LOG') or home / 'write-log.tsv').expanduser().resolve()
    state = Path(os.environ.get('CHEWBACCA_SESSION_STATE') or home / 'session-state').expanduser().resolve()
    repos = repositories(payload)
    if not repos:
        return
    log.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = log.with_suffix(log.suffix + '.lock')
    lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(lock_fd, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        rows = []
        now = time.time()
        exact = exact_targets(payload)
        for repo in repos:
            tool = payload.get('tool_use_id') or payload.get('tool_call_id')
            if not tool:
                tool = json.dumps([payload.get('tool_name'), payload.get('tool_input')], sort_keys=True)
            key = hashlib.sha256((sid + '\0' + str(repo) + '\0' + str(tool)).encode()).hexdigest()
            snapshot = state / (key + '.json')
            prior = json.loads(snapshot.read_text()) if snapshot.is_file() else None
            before = prior['files'] if prior is not None else None
            pending = int(prior['pending']) if prior is not None else 0
            if payload.get('hook_event_name') == 'ToolDenied':
                if pending > 1:
                    save(snapshot, dict(prior, pending=pending - 1))
                else:
                    snapshot.unlink(missing_ok=True)
                continue
            after = observe(repo, log, state)
            current_head = head(repo)
            is_pre = payload.get('hook_event_name') == 'PreToolUse'
            if is_pre and pending:
                save(snapshot, dict(prior, pending=pending + 1))
                continue  # Without native call IDs, retain the earliest overlapping baseline.
            if before is not None and not is_pre:
                changed = {path for path in set(before) | set(after) if before.get(path) != after.get(path)}
                committed = committed_paths(repo, prior.get('head'), current_head)
                changed.update(committed)
                started = float(prior.get('started') or 0)
                claimed = others_exact(log, sid, started - MTIME_SLACK) if started else set()
                for path in sorted(changed):
                    if path in exact:
                        rows.append(f'{now:.6f}\t{sid}\t{path}\tedit\n')
                        continue
                    # Another session's exact edit inside this call's window, or
                    # a file whose mtime falls outside it, was not this call's. A
                    # commit made inside the call is its own evidence, whatever
                    # the file's mtime.
                    stale = started and path not in committed and not touched_in_window(path, started, now)
                    if path in claimed or stale:
                        continue
                    rows.append(f'{now:.6f}\t{sid}\t{path}\tbash\n')
            remaining = 1 if is_pre else max(0, pending - 1)
            keep = not is_pre and remaining
            save(snapshot, {'files': before if keep else after,
                            'pending': remaining,
                            'head': prior.get('head') if keep else current_head,
                            'started': prior.get('started') if keep else now})
        if rows:
            fd = os.open(log, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
            with os.fdopen(fd, 'a') as stream:
                stream.writelines(rows)
                stream.flush()
                os.fsync(stream.fileno())


def main():
    try:
        record(json.load(sys.stdin))
    except (OSError, ValueError, subprocess.TimeoutExpired):
        print('write-log: repository observation unavailable; durability evidence may be incomplete.', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
