#!/usr/bin/env python3
"""Your week in one line, from the git repos already on this machine.

The first thing a new install shows. It needs no account, no model, no network
and no permission dialog, and every number it prints comes with the git command
that reproduces it, written to a receipt file the person can check.

The line answers the question a developer would actually pay attention to:
what did I ship this week, and what work exists only on this laptop right now
(uncommitted changes, commits never pushed, repos with no remote at all).

Read only. The only file it writes is the receipt.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime
import json
import os
import re
from pathlib import Path
import shlex
import subprocess
import sys
import time

# Where developers keep code. ~/Desktop, ~/Documents and ~/Downloads are left
# out on purpose: on macOS a terminal reading them raises a privacy dialog,
# and the first minute must not open with a permission prompt.
ROOTS = ('code', 'Code', 'Developer', 'dev', 'src', 'projects', 'Projects', 'repos',
         'git', 'github', 'GitHub', 'workspace', 'work', 'sites')
PROTECTED = ('Desktop', 'Documents', 'Downloads', 'Library', 'Pictures', 'Movies', 'Music')
# Depth 3 finds ~/code/org/repo/.git, the deepest layout seen across the
# stranger repos and this Mac's ~/code; deeper walks reached node_modules
# checkouts and vendored repos nobody thinks of as theirs.
MAX_DEPTH = 3
# Guessed, never measured on a big machine: enough for anyone's code folder,
# and it bounds the walk on a home full of clones.
MAX_REPOS = 400
SKIP_DIRS = {'node_modules', '.venv', 'venv', 'vendor', 'target', 'dist', 'build', '.cache', 'Pods'}


# These repos are anything cloned under the home folder, and a repo's own
# config can name programs git runs: an fsmonitor, hooks, an external diff, a
# clean filter that `status` invokes. Same prefix as write_log.SAFE and
# review_cross.GIT_SAFE, plus the filters, which read() switches off per repo.
SAFE = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=',
        '-c', 'core.untrackedCache=false', '-c', 'protocol.allow=never',
        # log.showSignature makes `log` run the signature verifier the repo names.
        '-c', 'log.showSignature=false', '-c', 'gpg.program=false', '-c', 'gpg.ssh.program=false',
        '-c', 'gpg.x509.program=false']


SAFE_NAME = re.compile(r'filter\.[A-Za-z0-9_.-]+\.(clean|smudge|process)')


def filters_off(repo):
    """-c overrides that empty every filter driver git would see here, or None
    when that can't be done safely: the query failed, or a driver name holds a
    character that could change how -c parses it. None means skip status.
    Reading config runs nothing, so asking first is safe."""
    try:
        done = subprocess.run([*SAFE, '-C', str(repo), 'config', '-z', '--name-only', '--get-regexp',
                               r'^filter\..*\.(clean|smudge|process)$'], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if done.returncode == 1:  # no filter drivers at all
        return []
    if done.returncode != 0:
        return None
    off = []
    for name in sorted({n for n in done.stdout.split('\0') if n}):
        if not SAFE_NAME.fullmatch(name):
            return None
        off += ['-c', name + '=', '-c', name.rsplit('.', 1)[0] + '.required=false']
    return off


def git(repo, *args, timeout=10, extra=()):
    try:
        done = subprocess.run([*SAFE, *extra, '-C', str(repo), *args], capture_output=True, text=True, errors='replace',
                              timeout=timeout, env=dict(os.environ, GIT_OPTIONAL_LOCKS='0', LC_ALL='C'))
    except (OSError, subprocess.TimeoutExpired):
        return None
    return done.stdout if done.returncode == 0 else None


def find_repos(home, extra=()):
    roots = [home / name for name in ROOTS] + [Path(p) for p in extra]
    seen, found = set(), []
    for root in roots:
        try:
            resolved = root.resolve()
            # By inode, not by name: on a case-insensitive Mac ~/code and ~/Code
            # are one folder, and walking both counted every commit twice.
            key = (resolved.stat().st_dev, resolved.stat().st_ino)
        except OSError:
            continue
        if not resolved.is_dir() or key in seen:
            continue
        if any(resolved == (home / p) or (home / p) in resolved.parents for p in PROTECTED):
            continue
        seen.add(key)
        stack = [(resolved, 0)]
        while stack and len(found) < MAX_REPOS:
            folder, depth = stack.pop()
            if (folder / '.git').exists():
                found.append(folder)
                continue
            if depth >= MAX_DEPTH:
                continue
            try:
                children = sorted(p for p in folder.iterdir()
                                  if p.is_dir() and not p.is_symlink()
                                  and not p.name.startswith('.') and p.name not in SKIP_DIRS)
            except OSError:
                continue
            stack.extend((child, depth + 1) for child in reversed(children))
    return found


def inspect(repo, email, since):
    common = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    if common is None:
        return None
    author = ['--author=' + email] if email else []
    log = git(repo, 'log', '--branches', '--no-merges', '--since=' + since, '--format=%H', *author)
    # Submodules carry their own config, so status never descends into them.
    off = filters_off(repo)
    status = None if off is None else git(repo, *status_args(), extra=off)
    remotes = (git(repo, 'remote') or '').split()
    # Unpushed means no remote branch holds the same change. Compared by patch
    # id, not by hash: a commit landed by cherry-pick or rebase gets a new hash,
    # and on this Mac hash matching called 202 commits unpushed (98 in one
    # repo) that were all on origin under other hashes. Not by subject either:
    # an amended commit keeps its subject and author time but not its content.
    local = patch_ids(repo, '--branches', '--not', '--remotes', '--since=' + since, *author)
    history_ok = local is not None
    local = local or {}
    unpushed = set(local)
    if local and remotes:
        remote = patch_ids(repo, '--remotes', '--since=' + since)
        if remote is None:
            history_ok = False
        else:
            landed = set(remote.values())
            unpushed = {h for h, pid in local.items() if pid is None or pid not in landed}
    try:
        common_id = os.stat(common.strip())
        common_key = f'{common_id.st_dev}:{common_id.st_ino}'
    except OSError:
        common_key = common.strip()
    return {'path': str(repo), 'common': common_key,
            'commits': set((log or '').split()), 'dirty': len(status.splitlines()) if status else 0,
            'unchecked': status is None or not history_ok, 'status_skipped': status is None,
            'filters_off': off or [],
            'unpushed': unpushed, 'remote': bool(remotes)}


def status_args():
    # Untracked files named explicitly: a repo's status.showUntrackedFiles=no
    # would otherwise hide a new file and the line would call the tree clean.
    return ('status', '--porcelain', '--ignore-submodules=all', '--untracked-files=normal')


LOG_ARGS = ('log', '-p', '--no-merges', '--no-ext-diff', '--no-textconv', '--no-color', '--format=commit %H')


def patch_ids(repo, *revs):
    """{commit: patch id} for the commits revs select (None for an empty commit,
    which has no patch id), or None when git could not answer. Bytes all the
    way: a diff of a Latin-1 file is not UTF-8, and decoding it crashed the scan."""
    listed = git(repo, 'log', '--no-merges', '--format=%H', *revs)
    if listed is None:
        return None
    hashes = listed.split()
    if not hashes:
        return {}
    ids = dict.fromkeys(hashes)
    try:
        patches = subprocess.run([*SAFE, '-C', str(repo), *LOG_ARGS, *revs], capture_output=True, timeout=30,
                                 env=dict(os.environ, GIT_OPTIONAL_LOCKS='0', LC_ALL='C'))
        if patches.returncode != 0:
            return None
        done = subprocess.run([*SAFE, '-C', str(repo), 'patch-id', '--stable'], input=patches.stdout,
                              capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if done.returncode != 0:
        return None
    for line in done.stdout.decode('ascii', 'replace').splitlines():
        pid, _, commit = line.partition(' ')
        if commit in ids:
            ids[commit] = pid
    return ids


def plural(n, word):
    return f'{n} {word}' + ('' if n == 1 else 's')


def week(home=None, extra=(), days=7):
    home = Path(home or Path.home())
    started = time.monotonic()
    email = (git(home, 'config', '--global', 'user.email') or '').strip()
    since = f'{days}.days.ago'
    repos = find_repos(home, extra)
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = [r for r in pool.map(lambda r: inspect(r, email, since), repos) if r]
    # Worktrees share history: count each commit once per repository.
    commits_by_repo = {}
    for row in rows:
        commits_by_repo.setdefault(row['common'], set()).update(row['commits'])
    names = {}
    for row in rows:
        names.setdefault(row['common'], Path(row['path']).name)
    active = {c: len(h) for c, h in commits_by_repo.items() if h}
    total = sum(active.values())
    dirty = [r for r in rows if r['dirty']]
    unchecked = {r['common']: r for r in rows if r['unchecked']}
    local_only = {r['common']: r for r in rows if not r['remote']}
    # Worktrees share branches, so unpushed commits are counted once per repo.
    unpushed = {}
    for row in rows:
        if row['remote'] and row['unpushed']:
            unpushed.setdefault(row['common'], set()).update(row['unpushed'])
    ahead = [{'path': next(r['path'] for r in rows if r['common'] == c), 'ahead': len(h)}
             for c, h in unpushed.items()]
    dirty_repos = {r['common'] for r in dirty}
    head = None
    if total:
        top = max(active, key=active.get)
        head = (f'{plural(total, "commit")} in {plural(len(active), "repo")} '
                f'(most in {names[top]}, {active[top]})')
    elif rows:
        head = f'no commits this week across {plural(len(rows), "repo")}'
    risk = []
    if dirty:
        risk.append(f'{plural(len(dirty_repos), "repo")} with uncommitted changes')
    if ahead:
        risk.append(f'{plural(sum(r["ahead"] for r in ahead), "commit")} from this week on no remote')
    if local_only:
        risk.append(f'{plural(len(local_only), "repo")} with no remote at all')
    machine = 'this Mac' if sys.platform == 'darwin' else 'this machine'
    if head and risk:
        line = f'Your week: {head}. Only on {machine}: ' + ', '.join(risk) + '.'
    elif head and not unchecked:
        line = f'Your week: {head}. Everything is committed and pushed.'
    elif head:
        line = f'Your week: {head}.'
    else:
        line = ('No git repos found in ~/code, ~/Developer, ~/dev, ~/src or the other usual code '
                'folders. Point it at one: chewbacca week --path <folder>')
    if unchecked:
        # A skipped or failed status is not a clean tree; never let it read as one.
        line += f' {plural(len(unchecked), "repo")} not fully checked (see the receipt).'
    return {'line': line, 'email': email, 'days': days, 'repos': rows, 'active': active,
            'names': names, 'dirty': dirty, 'unchecked': list(unchecked.values()), 'ahead': ahead, 'local_only': list(local_only.values()),
            'seconds': round(time.monotonic() - started, 2)}


def receipt(result, folder):
    """Every number in the line, next to the command that reproduces it."""
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f'week-{stamp}.md'
    lines = ['# Receipt: your week in one line', '', result['line'], '',
             f'Made {datetime.datetime.now():%Y-%m-%d %H:%M} in {result["seconds"]} s, read only, '
             f'from {plural(len(result["repos"]), "git repo")}. '
             f'Commits are yours by git email ({result["email"] or "no global user.email, so everyone"}), '
             f'last {result["days"]} days, local branches, merges left out.', '',
             'Check any number yourself:', '']
    # The same safe prefix the scan used: a receipt command must never run a
    # cloned repo's fsmonitor, hooks or filters either.
    def cmd(repo, *args, extra=()):
        return shlex.join([*SAFE, *extra, '-C', str(repo), *args])
    since = f'--since={result["days"]}.days.ago'
    author = ['--author=' + result['email']] if result['email'] else []
    for common, count in sorted(result['active'].items(), key=lambda kv: -kv[1]):
        repo = next(r['path'] for r in result['repos'] if r['common'] == common)
        lines.append(f'- {result["names"][common]}: {count} commits. '
                     f'`{cmd(repo, "log", "--branches", "--no-merges", since, *author, "--oneline")} | wc -l`')
    for r in result['dirty']:
        lines.append(f'- {Path(r["path"]).name}: {plural(r["dirty"], "uncommitted file")}. '
                     f'`{cmd(r["path"], *status_args(), extra=r["filters_off"])}`')
    for r in result['unchecked']:
        why = ('its filter config could not be switched off safely, so git status was not run there'
               if r['status_skipped'] else 'git could not read its history, so unpushed commits were not counted')
        lines.append(f'- {Path(r["path"]).name}: not fully checked: {why}.')
    for r in result['ahead']:
        lines.append(f'- {Path(r["path"]).name}: {plural(r["ahead"], "commit")} not on any remote. '
                     f'`{cmd(r["path"], "log", "--branches", "--not", "--remotes", "--no-merges", since, *author, "--oneline")}` '
                     'lists candidates; one whose change is on a remote under another hash (same `git patch-id`) counts as pushed.')
    for r in result['local_only']:
        lines.append(f'- {Path(r["path"]).name}: no remote. `{cmd(r["path"], "remote", "-v")}` prints nothing')
    path.write_text('\n'.join(lines) + '\n')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--path', action='append', default=[], help='another folder to look in')
    parser.add_argument('--days', type=int, default=7)
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--no-receipt', action='store_true')
    args = parser.parse_args()
    result = week(extra=args.path, days=args.days)
    home = Path(os.environ.get('CHEWBACCA_HOME', str(Path.home() / '.chewbacca'))).expanduser()
    where = None if args.no_receipt or not result['repos'] else receipt(result, home / 'receipts')
    if args.json:
        print(json.dumps({'line': result['line'], 'repos': len(result['repos']), 'seconds': result['seconds'],
                          'receipt': str(where) if where else None}))
    else:
        print(result['line'])
        if where:
            print('Receipt, with the git command behind each number: ' + str(where))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
