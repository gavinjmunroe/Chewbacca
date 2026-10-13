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


def git(repo, *args, timeout=10):
    try:
        done = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True,
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
    status = git(repo, 'status', '--porcelain') or ''
    remotes = (git(repo, 'remote') or '').split()
    # Unpushed means no remote branch holds the change. Matching on author time
    # plus subject, not on hash: a commit landed by cherry-pick or rebase gets a
    # new hash, and on this Mac hash matching called 202 commits unpushed (98
    # in one repo) that were all on origin under other hashes.
    fmt = '--format=%H %at %s'
    local = git(repo, 'log', '--branches', '--not', '--remotes', '--no-merges', '--since=' + since, fmt, *author) or ''
    landed = set()
    if local.strip() and remotes:
        for line in (git(repo, 'log', '--remotes', '--no-merges', '--since=' + since, fmt) or '').splitlines():
            landed.add(line.partition(' ')[2])
    unpushed = {line.split(' ', 1)[0] for line in local.splitlines()
                if line.strip() and line.partition(' ')[2] not in landed}
    try:
        common_id = os.stat(common.strip())
        common_key = f'{common_id.st_dev}:{common_id.st_ino}'
    except OSError:
        common_key = common.strip()
    return {'path': str(repo), 'common': common_key,
            'commits': set((log or '').split()), 'dirty': len(status.splitlines()),
            'unpushed': unpushed, 'remote': bool(remotes)}


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
        risk.append(f'{plural(sum(r["ahead"] for r in ahead), "commit")} from this week never pushed')
    if local_only:
        risk.append(f'{plural(len(local_only), "repo")} with no remote at all')
    machine = 'this Mac' if sys.platform == 'darwin' else 'this machine'
    if head and risk:
        line = f'Your week: {head}. Only on {machine}: ' + ', '.join(risk) + '.'
    elif head:
        line = f'Your week: {head}. Everything is committed and pushed.'
    else:
        line = ('No git repos found in ~/code, ~/Developer, ~/dev, ~/src or the other usual code '
                'folders. Point it at one: chewbacca week --path <folder>')
    return {'line': line, 'email': email, 'days': days, 'repos': rows, 'active': active,
            'names': names, 'dirty': dirty, 'ahead': ahead, 'local_only': list(local_only.values()),
            'seconds': round(time.monotonic() - started, 2)}


def receipt(result, folder):
    """Every number in the line, next to the command that reproduces it."""
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f'week-{stamp}.md'
    q = shlex.quote
    author = f' --author={q(result["email"])}' if result['email'] else ''
    lines = ['# Receipt: your week in one line', '', result['line'], '',
             f'Made {datetime.datetime.now():%Y-%m-%d %H:%M} in {result["seconds"]} s, read only, '
             f'from {plural(len(result["repos"]), "git repo")}. '
             f'Commits are yours by git email ({result["email"] or "no global user.email, so everyone"}), '
             f'last {result["days"]} days, local branches, merges left out.', '',
             'Check any number yourself:', '']
    for common, count in sorted(result['active'].items(), key=lambda kv: -kv[1]):
        repo = next(r['path'] for r in result['repos'] if r['common'] == common)
        lines.append(f'- {result["names"][common]}: {count} commits. '
                     f'`git -C {q(repo)} log --branches --no-merges --since={result["days"]}.days.ago{author} --oneline | wc -l`')
    for r in result['dirty']:
        lines.append(f'- {Path(r["path"]).name}: {plural(r["dirty"], "uncommitted file")}. `git -C {q(r["path"])} status --short`')
    for r in result['ahead']:
        lines.append(f'- {Path(r["path"]).name}: {plural(r["ahead"], "commit")} not on any remote. '
                     f'`git -C {q(r["path"])} log --branches --not --remotes --no-merges --since={result["days"]}.days.ago{author} --oneline` '
                     '(a commit whose author time and subject are on a remote counts as pushed)')
    for r in result['local_only']:
        lines.append(f'- {Path(r["path"]).name}: no remote. `git -C {q(r["path"])} remote -v` prints nothing')
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
