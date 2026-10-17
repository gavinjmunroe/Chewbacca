"""Scan instruction files for dead paths, links and commands (backlog 26).

Usage: python3 tools/stale_scan.py <repo> <file>...  (one JSON line per file)
Reads only. A backticked command is checked with `command -v`, so a bin/ tool
named bare in a doc is flagged when it is not on PATH (gtm and decision-inbox
were, 2026-10-16), and `chewbacca <sub>` with `chewbacca <sub> --help`.
Flags are candidates: triage each by hand and record it in
docs/reference/STALENESS-COVERAGE.md.
"""
import json, os, re, shutil, subprocess, sys
from pathlib import Path

repo = Path(sys.argv[1]).resolve()
home = Path.home()
PATHISH = re.compile(r'^(~/|\./|\.\./|/Users/|tools/|bin/|docs/|skills/|tests/|config/|\.claude/|library/|team/|hud/|second-brain/)[\w./@+-]*$')
CMD = re.compile(r'^([a-z][a-z0-9_.-]{1,30})(?:\s+(--?[a-z][\w-]*|[a-z][\w-]*))?')
SKIP_WORDS = set('a an the and or not is it if in on of to for with no yes use run see read write cd git ls cat grep sed awk echo printf python3 python bash sh zsh npm npx node make open curl jq rm cp mv mkdir find export source true false test set unset let as at by be do'.split())
helped = {}


def path_ok(token, base):
    t = token.rstrip('.,:;)')
    t = re.sub(r':\d+(-\d+)?$', '', t)
    if '<' in t or '*' in t or '{' in t or '$' in t:
        return None
    if t.startswith('~/'):
        return (home / t[2:]).exists()
    if t.startswith('/'):
        return Path(t).exists()
    for root in (base, repo, home):
        if (root / t).exists():
            return True
    return False


def chewbacca_sub(sub):
    if sub in helped:
        return helped[sub]
    try:
        r = subprocess.run(['chewbacca', sub, '--help'], capture_output=True, timeout=20, text=True)
        out = (r.stdout + r.stderr).lower()
        ok = r.returncode in (0, 1, 2) and 'unknown command' not in out and 'no such command' not in out and 'not a chewbacca command' not in out
    except Exception:
        ok = False
    helped[sub] = ok
    return ok


for name in sys.argv[2:]:
    f = (repo / name)
    text = f.read_text(errors='replace')
    base = f.parent
    dead_paths, dead_links, dead_cmds, urls = [], [], [], set()
    for target in re.findall(r'\]\(([^)\s]+)\)', text):
        if target.startswith(('http://', 'https://')):
            urls.add(target)
            continue
        if target.startswith(('#', 'mailto:')):
            continue
        t = target.split('#')[0].replace('%20', ' ')
        ok = path_ok(t, base)
        if ok is False:
            dead_links.append(target)
    for span in re.findall(r'`([^`\n]+)`', text):
        span = span.strip()
        for tok in span.split():
            if PATHISH.match(tok):
                ok = path_ok(tok, base)
                if ok is False:
                    dead_paths.append(tok)
        m = CMD.match(span)
        if m and ' ' in span and not span.endswith('.md'):
            word = m.group(1)
            if word in SKIP_WORDS or '/' in word or '.' in word:
                continue
            if shutil.which(word) is None:
                dead_cmds.append(span[:60])
            elif word == 'chewbacca' and m.group(2) and not m.group(2).startswith('-'):
                if not chewbacca_sub(m.group(2)):
                    dead_cmds.append(span[:60])
    print(json.dumps({'file': name, 'dead_paths': sorted(set(dead_paths)), 'dead_links': sorted(set(dead_links)),
                      'dead_cmds': sorted(set(dead_cmds)), 'urls': sorted(urls)}))
