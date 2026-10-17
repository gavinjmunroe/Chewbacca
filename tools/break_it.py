#!/usr/bin/env python3
"""Attack the current change before anyone calls it done, and write down what broke.

Caleb, 2026-10-16, 4:47 to 4:49pm: "I need you to see when a session is
complete, bc often times it is a false positive there's more stuff to do and
things that were broken that were missed". "When they build something and say
it's done, chewbs should attack it from every angle trying to break it before it
concludes anything!!!!!!!!!". That afternoon a Sabo call pitched a parent-company
lookup as "chewbs reasoned around the blocker" while the code read a hand-filled
parents.json, and tabs kept ending turns until he asked "Are you done with your
work? There's noting more you could do?".

review_gate.py asks an independent reviewer to READ the change. This module
tries to BREAK it, and checks the reply against what actually ran:

  ask      the original ask, split into clauses, each marked delivered, partly
           delivered or missing, with the evidence that decided it
  diff     added lines holding TODO, [NEED, a hard-coded client name, or a
           swallowed error
  tests    the touched tests, run again; after landing, run again on origin/main
  edges    every touched command run with --help, with empty input, and with a
           path that does not exist: a traceback is a break
  attacks  checks the agent declared with `break-it attack` (the real example,
           a second client, a failure path), run and recorded
  claims   each claim in the draft recap matched against something that ran
  others   files this change touched that another commit on origin/main
           changed afterward (two tabs on one file)

The receipt is bound to HEAD plus a hash of the uncommitted tree, so editing
after the attack makes it stale. Fixed means a break the previous receipt on
this branch listed that this run no longer finds.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
CLIENT_NAMES = ROOT / 'config/break-it/client-names.txt'

# Words that say the work is finished. Kept to the five Caleb's brief named plus
# "on main" and "all set", which today's tabs used for the same claim: 168 of the
# 709 turns logged on 2026-10-16 matched the five words alone.
# Widened after the steering study's cases: "Pushed. Now landing the Chewbacca
# half", "Togari's new guards are live" and "I reran the 18 tests and all pass"
# were done claims the first five words missed (cases 2, 3 and 4).
DONE_RE = re.compile(r"\b(done|landed|shipped|complete|completed|finished|all set|pushed|deployed|"
                     r"(is|are|it'?s|now) (on main|live)|all (\w+ )?pass(ed)?)\b", re.I)
# A negated or future claim is not a claim. "not landed yet", "isn't done",
# "hasn't finished", "when it's done", "once it lands" all read as done to the
# word list and are the honest reports this must never punish.
NEGATED_RE = re.compile(
    r"\b(not|n't|never|no(t)? yet|isn'?t|aren'?t|wasn'?t|haven'?t|hasn'?t|won'?t|"
    r"until|when|once|after|before|if|till|will|'ll|gonna|going to|would)\b[^.!?\n]{0,40}$", re.I)

STOP = set('''a an and the of to in on for with without from by at as is are was were be
been being it its it's this that these those there their them they we you u ur i
me my our your his her he she not no yes do does did done can could should would
will just also then than so but or if when what which who how all any each every
more most some such into onto out over up down off only own same too very via per
plz pls lol bro rn bc abt w gonna wanna make made get got let use using used
need needs want wants like one two three thing things stuff way new now still
sure really much many'''.split())

# Broad catches only. `except OSError: pass` and `|| true` after a read are this
# kit's normal idiom: on the 2026-10-16 replay `|| true` fired 5 times, all on
# `read -r -d ''` (which exits 1 at end of input) in a clean launch-guard fix.
SWALLOW_RES = [
    (re.compile(r'^except(\s+(Exception|BaseException))?\s*:\s*(pass|\.\.\.)\s*(#.*)?$'), 'swallowed exception'),
    (re.compile(r'catch\s*(\([^)]*\))?\s*\{\s*\}'), 'empty catch'),
]
# A client name inside a short string literal in code: a key, a value, a branch
# on the client. Comments and docstrings name the incident that set a rule, which
# the kit asks for: 80 of the 92 client-name hits on the replay were those.
STRING_RE = re.compile(r'(["\'])([^"\'\n]{0,40})\1')
TODO_RE = re.compile(r'\b(TODO|FIXME|XXX|HACK)\b|\[NEED')
CODE_SUFFIXES = {'.py', '.sh', '.js', '.mjs', '.ts', '.tsx', '.swift', ''}

TEST_CLAIM_RE = re.compile(r'(\d[\d,]*\s+(\w+\s+){0,3}tests?\s+(pass|passed|green)|'
                           r'tests?\s+(all\s+)?(pass|passed|are green|green))', re.I)
LANDED_CLAIM_RE = re.compile(r'\b(landed|on main|pushed|merged)\b', re.I)
SHA_RE = re.compile(r'\b([0-9a-f]{8,40})\b')
LIVE_CLAIM_RE = re.compile(r'\b(checked (it )?live|verified|confirmed|read it back|i checked)\b', re.I)
READ_ONLY = re.compile(r"^\s*(cd [^;&|]+(&&|;)\s*)?(cat|head|tail|less|ls|grep|rg|sed -n|wc|"
                       r"git (status|log|diff|show|branch|rev-parse)|echo|find|tabs)\b")
TEST_CMD_RE = re.compile(r'(pytest|unittest|tests?/|test_|run\.sh|npm (run )?test|vitest|jest|mocha|'
                         r'(bun|deno|cargo|go|swift) test|break-it|break_it|gtme ready|closeout)')
WRITE_TOOLS = {'Write', 'Edit', 'MultiEdit', 'NotebookEdit'}


def sh(args, cwd, timeout=60, stdin=None):
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                           timeout=timeout, input=stdin)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, '', 'timed out after %ss' % timeout
    except OSError as error:
        return 127, '', str(error)


def git(repo, *args, timeout=30):
    code, out, _ = sh(['git', '-C', str(repo), *args], repo, timeout=timeout)
    return out if code == 0 else None


# ── transcript ────────────────────────────────────────────────────────────

def _text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return '\n'.join(b.get('text', '') for b in content
                         if isinstance(b, dict) and b.get('type') == 'text')
    return ''


MACHINE_PREFIXES = ('<', 'Stop hook feedback', 'Another Claude session', '[Request interrupted',
                    'This session is being continued', 'Caveat:', '[Image', 'Base directory for this skill')


def strip_reminders(text):
    """A side session's brief arrives behind <system-reminder> blocks."""
    return re.sub(r'<system-reminder>.*?</system-reminder>', ' ', text, flags=re.S).strip()


def is_human(text):
    t = strip_reminders(text)
    return bool(t) and not t.startswith(MACHINE_PREFIXES)


def read_transcript(path):
    """Events of a Claude Code JSONL transcript, in order, as plain dicts."""
    events = []
    try:
        lines = Path(path).read_text(errors='replace').splitlines()
    except OSError:
        return events
    errors = set()
    for raw in lines:
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        msg = d.get('message') or {}
        content = msg.get('content')
        ts = d.get('timestamp', '')
        if d.get('type') == 'user':
            if isinstance(content, list) and any(isinstance(b, dict) and b.get('type') == 'tool_result'
                                                 for b in content):
                for b in content:
                    if isinstance(b, dict) and b.get('type') == 'tool_result':
                        out = b.get('content')
                        out = _text(out) if isinstance(out, list) else str(out or '')
                        events.append({'kind': 'result', 'id': b.get('tool_use_id'),
                                       'error': bool(b.get('is_error')), 'text': out[:4000], 'ts': ts})
                        if b.get('is_error'):
                            errors.add(b.get('tool_use_id'))
                continue
            events.append({'kind': 'user', 'text': _text(content), 'ts': ts})
        elif d.get('type') == 'assistant' and isinstance(content, list):
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get('type') == 'text' and b.get('text', '').strip():
                    events.append({'kind': 'say', 'text': b['text'], 'ts': ts})
                elif b.get('type') == 'tool_use':
                    events.append({'kind': 'tool', 'name': b.get('name', ''), 'id': b.get('id'),
                                   'input': b.get('input') or {}, 'ts': ts})
    for e in events:
        if e['kind'] == 'tool':
            e['error'] = e.get('id') in errors
    return events


def asks(events):
    """The ask this work answers: the first human message (a side session's brief,
    or the tab's opener) and the latest human one, deduplicated."""
    humans = [strip_reminders(e['text']) for e in events if e['kind'] == 'user' and is_human(e['text'])]
    if not humans:
        return []
    picked = [humans[0]] if humans[0] == humans[-1] else [humans[0], humans[-1]]
    return picked


def turn_events(events):
    """Events since the latest human message: the stretch a done claim covers."""
    start = 0
    for i, e in enumerate(events):
        if e['kind'] == 'user' and is_human(e['text']):
            start = i
    return events[start:]


def command_of(e):
    return str(e['input'].get('command', '')) if e['name'] == 'Bash' else ''


DOC_SUFFIXES = ('.md', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.csv')


def is_write(e, code_only=False):
    if e['kind'] != 'tool':
        return False
    if e['name'] in WRITE_TOOLS:
        path = str(e['input'].get('file_path') or e['input'].get('notebook_path') or '')
        # A memory note or a doc written after the tests ran does not make the
        # tests stale. On the 2026-10-16 replay, 9 of 14 "nothing ran after the
        # last write" hits on clean finishes were a note written after a green run.
        return not (code_only and path.endswith(DOC_SUFFIXES))
    if code_only:
        return False
    low = command_of(e).lower()
    # A heredoc that patches a file is a write, the same rule vibe-guard uses.
    return bool(re.search(r"<<\s*'?py'?", low)) and not any(w in low for w in ('test', 'check', 'build'))


def written_paths(events):
    paths = []
    for e in events:
        if e['kind'] == 'tool' and e['name'] in WRITE_TOOLS:
            p = e['input'].get('file_path') or e['input'].get('notebook_path')
            if p and p not in paths:
                paths.append(p)
    return paths


def runs_after_last_write(events, code_only=True):
    """Commands that ran and did not error after the last code write, reads excluded."""
    last = -1
    for i, e in enumerate(events):
        if is_write(e, code_only):
            last = i
    out = []
    for e in events[last + 1:]:
        cmd = command_of(e) if e['kind'] == 'tool' else ''
        if cmd and not e.get('error') and not READ_ONLY.search(cmd):
            out.append(cmd)
    return out, last >= 0


# ── ask clauses ───────────────────────────────────────────────────────────

def stem(word):
    word = word.lower().strip("'")
    for suffix in ('ings', 'ing', 'ers', 'ies', 'ed', 'es', 's', 'er'):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            return word[:-len(suffix)]
    return word


def keywords(text):
    words = re.findall(r"[A-Za-z][A-Za-z0-9_\-']{2,}", text)
    return sorted({stem(w) for w in words if w.lower() not in STOP and len(w) > 3})


def clauses(ask):
    """Numbered items, bullets, then sentences. A clause needs three content words:
    "Fix chewbs" alone carries nothing a diff could be checked against."""
    text = re.sub(r'<[^>]{1,200}>', ' ', ask)
    parts = re.split(r'\n\s*(?:\d+[.)]|[-*•])\s+|\n{2,}|(?<=[.!?])\s+(?=[A-Z])', text)
    out = []
    for part in parts:
        part = ' '.join(part.split())
        if len(keywords(part)) >= 3 and part not in out:
            out.append(part[:300])
    return out[:25]


def judge_clauses(ask_texts, corpus, reply):
    corpus_words = set(keywords(corpus))
    reply_words = set(keywords(reply))
    rows = []
    for ask in ask_texts:
        for clause in clauses(ask):
            kws = keywords(clause)
            hit = [k for k in kws if k in corpus_words]
            share = len(hit) / len(kws)
            # Thresholds guessed, then checked on the 2026-10-16 replay in
            # tests/fixtures/break_it: at 0.5 and 0.25 every clause of the
            # three real clean finishes read delivered or partly.
            status = 'delivered' if share >= 0.5 else 'partly' if share >= 0.25 else 'missing'
            rows.append({'clause': clause, 'status': status, 'evidence': hit[:8],
                         'mentioned_in_reply': bool(set(kws) & reply_words)})
    return rows


# ── repository ────────────────────────────────────────────────────────────

def repo_root(path):
    p = Path(path)
    p = p if p.is_dir() else p.parent
    while not p.exists() and p != p.parent:
        p = p.parent
    out = git(p, 'rev-parse', '--show-toplevel')
    return Path(out.strip()) if out else None


def base_ref(repo, base):
    for ref in ([base] if base else []) + ['origin/main', 'origin/master', 'main']:
        if git(repo, 'rev-parse', '--verify', '--quiet', ref):
            return ref
    return None


def tree_state(repo):
    head = (git(repo, 'rev-parse', 'HEAD') or '').strip()
    status = git(repo, 'status', '--porcelain=v1', '--untracked-files=normal') or ''
    diff = git(repo, 'diff', 'HEAD') or ''
    dirty = hashlib.sha256((status + diff).encode()).hexdigest()[:16] if status.strip() else ''
    return head, dirty


def changed_files(repo, base):
    """Files this branch changed against the base, plus uncommitted ones."""
    names = set()
    mb = (git(repo, 'merge-base', base, 'HEAD') or '').strip() if base else ''
    if mb:
        names.update((git(repo, 'diff', '--name-only', mb, 'HEAD') or '').split())
    # A landed change: HEAD is on the base, so the merge-base IS HEAD and the
    # diff above is empty. Fall back to this branch's own commits.
    if not names and base and mb == (git(repo, 'rev-parse', 'HEAD') or '').strip():
        log = git(repo, 'log', '--format=', '--name-only', '-n', '1', 'HEAD') or ''
        names.update(log.split())
    names.update((git(repo, 'diff', '--name-only', 'HEAD') or '').split())
    names.update((git(repo, 'ls-files', '--others', '--exclude-standard') or '').split())
    return sorted(n for n in names if (repo / n).exists())


def added_lines(repo, base, files):
    mb = (git(repo, 'merge-base', base, 'HEAD') or '').strip() if base else ''
    if mb and mb == (git(repo, 'rev-parse', 'HEAD') or '').strip():
        mb = 'HEAD~1'
    out = {}
    for name in files:
        if (repo / name).is_dir():
            continue
        tracked = git(repo, 'ls-files', '--error-unmatch', name)
        if tracked is None:
            try:
                out[name] = (repo / name).read_text(errors='replace').splitlines()[:5000]
            except OSError:
                pass
            continue
        diff = git(repo, 'diff', '-U0', mb or 'HEAD', '--', name) or ''
        out[name] = [l[1:] for l in diff.splitlines() if l.startswith('+') and not l.startswith('+++')]
    return out


def client_names(repo=None):
    """Names from the checked repo's own list. A repo opts in by shipping
    config/break-it/client-names.txt. Togari is multi-tenant and names its tenant
    on purpose: on the 2026-10-16 replay its "zeutara" tenant literals were 7 of
    the 10 client-name hits left on clean finishes."""
    path = Path(repo) / 'config/break-it/client-names.txt' if repo else CLIENT_NAMES
    try:
        return [l.strip() for l in path.read_text().splitlines()
                if l.strip() and not l.startswith('#')]
    except OSError:
        return []


def is_code(name):
    p = Path(name)
    if any(part in ('tests', 'test', 'fixtures', 'docs', 'memory') for part in p.parts):
        return False
    if p.name.startswith('test_') or p.suffix in ('.md', '.json', '.txt', '.yaml', '.yml', '.csv'):
        return False
    return p.suffix in CODE_SUFFIXES and (p.parts[0] in ('bin', 'tools', 'tests', '.claude', 'skills', 'scripts', 'src', 'lib', 'app')
                                         or p.suffix != '')


def grep_diff(lines_by_file, repo=None):
    breaks = []
    names = client_names(repo)
    name_re = re.compile(r'\b(' + '|'.join(re.escape(n) for n in names) + r')\b', re.I) if names else None
    for name, lines in lines_by_file.items():
        if name.endswith('break_it.py') or name.startswith('config/break-it/'):
            continue  # this module's own patterns
        in_doc = False
        for n, line in enumerate(lines):
            s = line.strip()
            code = is_code(name)
            quotes = s.count('"""') + s.count("'''")
            was_doc = in_doc
            if quotes % 2 == 1:
                in_doc = not in_doc
            prose = was_doc or quotes > 0 or s.startswith(('#', '//', '*', '/*', '--'))
            m = TODO_RE.search(s)
            # A TODO counts in code; a [NEED marker counts in a deliverable. Text
            # that talks ABOUT the marker (in backticks or quotes, or code that
            # parses it) is not one: three of the 18 clean-finish hits on the
            # 2026-10-16 replay were gtme_lessons.py handling "[NEED".
            # A line naming the patterns themselves ("TODO, [NEED, client names")
            # is documentation of a check, which break-it flagged in its own hook.
            describes = bool(re.search(r'[`"\'](TODO|\[NEED)|TODO,\s*\[NEED', s))
            if m and (code != m.group(0).startswith('[NEED')) and not describes:
                # A [NEED] blank in a draft is what context-discipline.md asks
                # for in place of an invented number, so it is noted, never
                # blocking: the one clean finish it blocked on the replay was an
                # attribution term with its fee and window left as [NEED].
                breaks.append({'kind': 'todo' if code else 'need-marker', 'where': name, 'detail': s[:160]})
            if not code:
                continue
            nxt = lines[n + 1].strip() if n + 1 < len(lines) else ''
            if re.match(r'^except(\s+(Exception|BaseException))?\s*:\s*$', s) and nxt in ('pass', '...'):
                breaks.append({'kind': 'swallowed-error', 'where': name, 'detail': f'broad except, then {nxt}'})
            for rx, label in SWALLOW_RES:
                if rx.search(s):
                    breaks.append({'kind': 'swallowed-error', 'where': name, 'detail': f'{label}: {s[:140]}'})
            hit = None
            if name_re and not prose:
                for lit in STRING_RE.finditer(s):
                    hit = hit or name_re.search(lit.group(2))
            # A client's own repo or folder names the client; that is where the
            # name belongs (zeutara-gtme, "Sabo handoff").
            if hit and hit.group(0).lower().replace(' ', '') not in name.lower().replace(' ', '').replace('-', ''):
                breaks.append({'kind': 'hard-coded-client', 'where': name,
                               'detail': f'{hit.group(0)}: {s[:140]}'})
    return breaks


# ── running attacks ───────────────────────────────────────────────────────

def touched_tests(repo, files):
    """Test files the change touched, plus tests named after a touched code file.
    Two misses from running break-it on its own change: tests/run.sh is the suite
    runner, not a test (it took the repo path as a group name), and on a
    case-insensitive disk MEMORY.md matched tests/test_MEMORY.py by is_file()."""
    runners = {'run.sh', 'lib.sh', 'helpers.sh', 'conftest.py'}
    tests = [f for f in files if f.startswith('tests/') and f.endswith(('.py', '.sh'))
             and 'fixtures' not in f and Path(f).name not in runners]
    stems = {Path(f).stem.replace('-', '_') for f in files
             if not f.startswith('tests/') and Path(f).suffix in CODE_SUFFIXES}
    tdir = repo / 'tests'
    names = set(os.listdir(tdir)) if tdir.is_dir() else set()
    for s in stems:
        if len(s) < 4:
            continue
        for cand in (f'test_{s}.py', f'{s}.sh'):
            if cand in names and cand not in runners and f'tests/{cand}' not in tests:
                tests.append(f'tests/{cand}')
    return tests[:12]


def run_test(repo, test, timeout):
    path = repo / test
    if test.endswith('.py'):
        args = [sys.executable, '-m', 'pytest', '-q', '-x', '-p', 'no:cacheprovider', str(path)]
        code, out, err = sh([sys.executable, '-c', 'import pytest'], repo, timeout=20)
        if code:
            args = [sys.executable, str(path)]
    else:
        args = ['bash', str(path), str(repo)]
    code, out, err = sh(args, repo, timeout=timeout)
    tail = (out + err).strip().splitlines()[-6:]
    return code, tail


def entrypoints(repo, files):
    out = []
    for f in files:
        p = repo / f
        if f.startswith(('tests/', 'docs/')) or not p.is_file():
            continue
        if f.startswith('bin/') and os.access(p, os.X_OK):
            out.append(f)
        elif f.startswith('tools/') and f.endswith('.py'):
            head = p.read_text(errors='replace')
            if '__main__' in head and 'argparse' in head:
                out.append(f)
    return out[:8]


def probe_env(home):
    """No inherited secrets: a probe is code the agent just wrote, fed garbage.
    The security review of 2a86fede flagged the full environment, API keys
    included, reaching it from a Stop hook nobody invoked."""
    keep = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL', 'TERM') if k in os.environ}
    return dict(keep, HOME=home, TMPDIR=home, CHEWBACCA_BREAK_IT_PROBE='1', JEV_OFF='1')


def trusted_repo(repo):
    """The Stop hook runs probes only in this kit's own checkout or one of its
    worktrees: the same git common dir as the checkout break_it.py lives in. A
    turn that wrote into some other clone gets the read-only checks."""
    def common(path):
        out = git(Path(path), 'rev-parse', '--path-format=absolute', '--git-common-dir')
        return Path(out.strip()).resolve() if out else None
    mine = common(ROOT)
    return mine is not None and common(repo) == mine


def edge_attacks(repo, files, timeout=20, budget=None):
    """Help, then each subcommand fed garbage, a wrong-shaped JSON and a missing
    path. Exit codes are free to be nonzero; a Python traceback or a bash
    'unbound variable' is the break. Built from case 9 of the 2026-10-16 steering
    study: next_move.py landed as done with 20 green tests, and `plan -` fed
    "not json", "[]" or "null" on stdin crashed with a traceback."""
    results = []
    started = time.time()
    for f in entrypoints(repo, files):
        p = repo / f
        base = [sys.executable, str(p)] if f.endswith('.py') else [str(p)]
        home = tempfile.mkdtemp(prefix='break-it-home-')
        env = probe_env(home)

        def probe(label, extra, stdin=''):
            if budget and time.time() - started > budget:
                return None
            try:
                r = subprocess.run(base + extra, cwd=repo, capture_output=True, text=True,
                                   timeout=timeout, input=stdin, env=env)
            except subprocess.TimeoutExpired:
                # Waiting on input is how a stdin reader looks; a hang only
                # counts on --help.
                results.append({'what': f'{f} {label}', 'ok': label != '--help',
                                'detail': 'hung past %ss' % timeout if label == '--help' else ''})
                return ''
            except OSError as error:
                results.append({'what': f'{f} {label}', 'ok': False, 'detail': str(error)[:160]})
                return ''
            text = r.stdout + r.stderr
            broke = 'Traceback (most recent call last)' in text or 'unbound variable' in text
            results.append({'what': f'{f} {label}', 'ok': not broke,
                            'detail': text.strip().splitlines()[-1][:160] if broke and text.strip() else ''})
            return text

        helptext = probe('--help', ['--help']) or ''
        m = re.search(r'\{([A-Za-z0-9_,-]+)\}', helptext)
        subs = [[s] for s in m.group(1).split(',')][:6] if m else [[]]
        for sub in subs:
            name = ' '.join(sub) or '(no subcommand)'
            for label, extra, stdin in ((f'{name} garbage stdin', sub + ['-'], 'not json \x00{['),
                                        (f'{name} wrong-shape stdin', sub + ['-'], '[]'),
                                        (f'{name} missing path', sub + ['/nonexistent/break-it-probe'], '')):
                if probe(label, extra, stdin) is None:
                    return results
    return results


def on_base_tests(repo, base, tests, timeout):
    """After landing: the touched tests again, on a fresh worktree of the base."""
    head = (git(repo, 'rev-parse', 'HEAD') or '').strip()
    if not base or not tests or git(repo, 'merge-base', '--is-ancestor', head, base) is None:
        return None
    tmp = Path(tempfile.mkdtemp(prefix='break-it-base-'))
    wt = tmp / 'wt'
    if git(repo, 'worktree', 'add', '--detach', str(wt), base, timeout=120) is None:
        return [{'what': f'worktree of {base}', 'ok': False, 'detail': 'could not be created'}]
    try:
        out = []
        for t in tests:
            code, tail = run_test(wt, t, timeout)
            out.append({'what': f'{t} on {base}', 'ok': code == 0, 'detail': ' | '.join(tail[-2:]) if code else ''})
        return out
    finally:
        git(repo, 'worktree', 'remove', '--force', str(wt), timeout=60)


def others_after(repo, base, files):
    """Commits on the base that touched our files after our HEAD: another tab on the same file."""
    if not base:
        return []
    out = git(repo, 'log', '--format=%h %s', f'HEAD..{base}', '--', *files[:50]) if files else ''
    return [l for l in (out or '').splitlines() if l][:10]


# ── claims in the recap ───────────────────────────────────────────────────

def sentences(text):
    return [s.strip() for s in re.split(r'(?<=[.!?])\s+|\n+', text) if s.strip()]


def check_claims(reply, events, repo, base):
    """Each claim needs something that ran. Test claims need a passing test run after
    the last write; landed claims need the named commit on the base; live checks
    need a command that was not a read."""
    out = []
    runs, wrote = runs_after_last_write(events)
    all_runs = [command_of(e) for e in events if e['kind'] == 'tool' and command_of(e) and not e.get('error')]
    for s in sentences(reply):
        if TEST_CLAIM_RE.search(s) and not NEGATED_RE.search(s[:TEST_CLAIM_RE.search(s).start()]):
            ok = any(TEST_CMD_RE.search(c) for c in runs) if wrote else any(TEST_CMD_RE.search(c) for c in all_runs)
            out.append({'claim': s[:200], 'ok': ok,
                        'evidence': 'a passing test run after the last write' if ok else
                        'no passing test command ran after the last write'})
        m = LANDED_CLAIM_RE.search(s)
        if m and not NEGATED_RE.search(s[:m.start()]) and repo is not None and base:
            shas = [x for x in SHA_RE.findall(s) if not x.isdigit()]
            for sha in shas[:4]:
                full = (git(repo, 'rev-parse', '--verify', '--quiet', sha + '^{commit}') or '').strip()
                ok = bool(full) and git(repo, 'merge-base', '--is-ancestor', full, base) is not None
                out.append({'claim': s[:200], 'ok': ok,
                            'evidence': f'{sha} is on {base}' if ok else f'{sha} is not on {base} here'})
        if LIVE_CLAIM_RE.search(s) and not NEGATED_RE.search(s):
            ok = bool(runs) if wrote else bool(all_runs)
            out.append({'claim': s[:200], 'ok': ok,
                        'evidence': 'a command ran' if ok else 'only reads ran after the last write'})
    return out


# ── transcript-only findings (the Stop hook's fast path) ─────────────────

# A reply that says done while naming work still in flight. 2026-10-16,
# exciting-shirley: "Everything from this session has landed" went out, the
# next turn said "That last note is landing in the background rn", and the one
# after "The last memory note is on main too". Each was a conclusion drawn
# before the evidence existed.
IN_FLIGHT_RE = re.compile(
    r"\b(still (running|going|landing|in flight|queued|waiting)|landing (it )?(in the background|now|rn)|"
    r"(is|are|'s) (queued|landing|running) |hasn'?t (reported|landed|started|run)|"
    r"haven'?t (confirmed|checked|run|landed|tested)|"
    r"not (landed|merged|pushed|confirmed|verified|tested) yet|nothing has run|untested|"
    r"(will|i'?ll) (check|confirm|verify|land) (it |that |this )?(when|once|after|later|tonight|tomorrow))", re.I)


def written_text(events):
    """What the turn wrote, per file: Write content and Edit replacements."""
    out = {}
    for e in events:
        if e['kind'] != 'tool' or e['name'] not in WRITE_TOOLS:
            continue
        i = e['input']
        p = i.get('file_path') or i.get('notebook_path') or ''
        text = i.get('content') or i.get('new_string') or ''
        for edit in i.get('edits') or []:
            text += '\n' + str(edit.get('new_string', ''))
        old = set(str(i.get('old_string') or '').splitlines())
        # An Edit's replacement repeats its context; only lines it adds count.
        out.setdefault(p, []).extend(l for l in str(text).splitlines() if l not in old)
    return out


# Where a change to the checkout actually runs from. A hook is COPIED to
# ~/.claude/hooks by setup.sh, and kit commands run from the shared checkout.
# 2026-10-16: three of the six false-done episodes on the replay were this. The
# launch-guard fix passed its tests while the installed hook still refused the
# same `cd` an hour later, and the spend-allowance tab said done while "the
# shared checkout's bin/chewbacca-clay may still be behind main".
SYNC_RE = re.compile(r'(setup\.sh|sync-hooks|hooks (sync|install)|cp [^|;&]*\.claude/hooks|install -m|'
                     r'chewbacca (update|sync|setup))')


def running_copy(rel):
    if rel.startswith('.claude/hooks/'):
        return Path.home() / '.claude/hooks' / Path(rel).name
    return None


def not_live(turn, repo, rel_paths, check_disk=True):
    """Touched files whose running copy is not the one just changed."""
    if any(SYNC_RE.search(command_of(e)) for e in turn if e['kind'] == 'tool'):
        return []
    out = []
    for rel in rel_paths:
        target = running_copy(rel)
        if target is None:
            continue
        if check_disk:
            try:
                if target.read_bytes() == (Path(repo) / rel).read_bytes():
                    continue
            except OSError:
                pass
        out.append({'kind': 'not-live', 'where': rel,
                    'detail': f'{target} is the copy that runs, and it is not this change'})
    return out


# The kinds a Stop hook refuses on. ask-missing and in-flight stay in the
# receipt as notes: on the 2026-10-16 replay ask-missing hit 17 clean finishes
# and no false one (it reads chatter like "This shit's insane" as a clause), and
# in-flight hit 10 clean to 1 false, mostly honest "the suite is queued" lines.
BLOCKING = {'uncommitted', 'nothing-ran', 'nothing-attacked', 'not-live', 'hard-coded-client', 'todo',
            'swallowed-error', 'unbacked-claim', 'attack-broke', 'another-tab', 'no-declared-attack'}


def fast_findings(turn, reply, ask_texts, repo=None, base=None, check_disk=True):
    """Breaks a done claim can be checked for from the transcript alone, in well
    under a second: no test runs. The Stop hook uses this when no full receipt
    exists, and replays of old transcripts use it to measure the hook."""
    found = []
    runs, wrote = runs_after_last_write(turn)
    if wrote and not runs:
        found.append({'kind': 'nothing-ran', 'where': '',
                      'detail': 'files changed and nothing ran after the last write'})
    rel = {}
    for p, lines in written_text(turn).items():
        if repo is None:
            continue
        try:
            rel[str(Path(p).resolve().relative_to(Path(repo).resolve()))] = lines
        except (ValueError, OSError):
            continue  # scratch files, notes outside the repo
    found += grep_diff(rel, repo)
    if repo is not None:
        found += not_live(turn, repo, list(rel), check_disk)
    tests = [c for c in runs if TEST_CMD_RE.search(c)]
    probes = [c for c in runs if not TEST_CMD_RE.search(c)
              and not re.search(r'^\s*(cd [^;&|]+&&\s*)?(git |chewbacca land|tabs |work-ledger)', c)]
    if wrote and runs and not tests and not probes:
        found.append({'kind': 'nothing-attacked', 'where': '',
                      'detail': 'after the last code change only git and bookkeeping ran: no test, no real run'})
    for c in check_claims(reply, turn, repo, base):
        if not c['ok']:
            found.append({'kind': 'unbacked-claim', 'where': '', 'detail': f"{c['claim'][:110]} ({c['evidence']})"})
    for s in sentences(reply):
        m = IN_FLIGHT_RE.search(s)
        if m and not re.search(r"\b(nothing|no one|none|not)\b", s[:m.start()], re.I):
            found.append({'kind': 'in-flight', 'where': '', 'detail': s[:160]})
            break
    corpus = ' '.join(command_of(e) + ' ' + str(e['input'].get('file_path', '')) for e in turn if e['kind'] == 'tool')
    corpus += ' ' + ' '.join(' '.join(v) for v in rel.values())
    for row in judge_clauses(ask_texts, corpus, reply):
        if row['status'] == 'missing' and not row['mentioned_in_reply']:
            found.append({'kind': 'ask-missing', 'where': '', 'detail': row['clause'][:160]})
    return found


# ── receipts ──────────────────────────────────────────────────────────────

def receipt_dir(repo):
    gd = (git(repo, 'rev-parse', '--git-dir') or '').strip()
    gd = Path(gd) if os.path.isabs(gd) else repo / gd
    d = gd / 'break-it'
    d.mkdir(parents=True, exist_ok=True)
    return d


def attacks_file(repo):
    return receipt_dir(repo) / 'attacks.jsonl'


def receipt_path(repo, head):
    return receipt_dir(repo) / f'{head}.json'


def latest_receipt(repo):
    d = receipt_dir(repo)
    files = sorted(d.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
    for f in files:
        try:
            return json.loads(f.read_text())
        except (OSError, ValueError):
            continue
    return None


def break_key(b):
    return f"{b.get('kind')}|{b.get('where', '')}|{b.get('detail', '')[:80]}"


# Breaks a reply cannot talk its way past. "Done" said over a change that is not
# the copy that runs is the false positive Caleb named on 2026-10-16, even when
# the reply admits it: the launch-guard tab said "the live hook ... doesn't have
# this change yet", called it done, and its own `cd` was refused an hour later.
MUST_FIX = {'not-live', 'uncommitted'}


def unreported(breaks, reply):
    return [b for b in breaks if b['kind'] in MUST_FIX or not mentioned(b, reply)]


def mentioned(b, reply):
    """An open break counts as reported when the reply names its file or its first words."""
    low = reply.lower()
    where = (b.get('where') or '').lower()
    if where and (where in low or Path(where).name.lower() in low):
        return True
    words = [w for w in keywords(b.get('detail', '') or b.get('what', ''))[:4]]
    return bool(words) and sum(w in set(keywords(reply)) for w in words) >= max(2, len(words) // 2)


# ── commands ──────────────────────────────────────────────────────────────

def cmd_attack(args):
    repo = repo_root(args.repo) or Path(args.repo).resolve()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        print('break-it attack: give the command after --', file=sys.stderr)
        return 2
    started = time.time()
    code, out, err = sh(command, repo, timeout=args.timeout)
    want_fail = args.expect == 'fail'
    ok = (code != 0) if want_fail else (code == 0)
    if 'Traceback (most recent call last)' in (out + err):
        ok = False
    rec = {'what': args.message, 'command': shlex.join(command), 'expect': args.expect, 'exit': code,
           'ok': ok, 'seconds': round(time.time() - started, 1),
           'tail': (out + err).strip().splitlines()[-3:], 'head': tree_state(repo)[0]}
    with attacks_file(repo).open('a') as fh:
        fh.write(json.dumps(rec) + '\n')
    print(('held  ' if ok else 'BROKE ') + args.message + f' (exit {code}, wanted {args.expect})')
    for line in rec['tail']:
        print('      ' + line)
    return 0 if ok else 1


def declared_attacks(repo, head):
    try:
        lines = attacks_file(repo).read_text().splitlines()
    except OSError:
        return []
    out = {}
    for line in lines:
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get('head') == head:
            out[r['what']] = r  # the latest run of each attack wins
    return list(out.values())


def run(args):
    events = read_transcript(args.transcript) if args.transcript else []
    reply = ''
    if args.reply == '-':
        reply = sys.stdin.read()
    elif args.reply:
        reply = Path(args.reply).read_text()
    else:
        says = [e['text'] for e in turn_events(events) if e['kind'] == 'say']
        reply = says[-1] if says else ''
    ask_texts = [args.ask] if args.ask else asks(events)

    repo = repo_root(args.repo) if args.repo else None
    base = base_ref(repo, args.base) if repo else None
    files = changed_files(repo, base) if repo else []
    lines = added_lines(repo, base, files) if repo else {}
    head, dirty = tree_state(repo) if repo else ('', '')

    attacked, breaks = [], []
    corpus = ' '.join(files) + ' ' + ' '.join(' '.join(v) for v in lines.values())
    corpus += ' ' + ' '.join(command_of(e) for e in events if e['kind'] == 'tool')
    corpus += ' ' + ' '.join(str(e['input'].get('file_path', '')) for e in events if e['kind'] == 'tool')

    ask_rows = judge_clauses(ask_texts, corpus, reply)
    attacked.append(f'the ask, {len(ask_rows)} clauses')
    for row in ask_rows:
        if row['status'] == 'missing' and not row['mentioned_in_reply']:
            breaks.append({'kind': 'ask-missing', 'where': '', 'detail': row['clause'][:160]})

    if repo:
        attacked.append(f'the diff, {len(files)} files: TODO, [NEED, client names, swallowed errors')
        breaks += grep_diff(lines, repo)
        for line in others_after(repo, base, files):
            breaks.append({'kind': 'another-tab', 'where': '', 'detail': f'{base} changed a touched file after this: {line}'})
        attacked.append('concurrency: later commits on the base to the same files')

    claim_rows = check_claims(reply, events, repo, base) if reply else []
    if claim_rows:
        attacked.append(f'{len(claim_rows)} claims in the reply')
    for c in claim_rows:
        if not c['ok']:
            breaks.append({'kind': 'unbacked-claim', 'where': '', 'detail': f"{c['claim'][:110]} ({c['evidence']})"})

    runs = []
    if repo and not args.fast:
        tests = touched_tests(repo, files)
        for t in tests:
            code, tail = run_test(repo, t, args.timeout)
            runs.append({'what': t, 'ok': code == 0, 'detail': ' | '.join(tail[-2:]) if code else ''})
        if tests:
            attacked.append(f'{len(tests)} touched tests run again')
        edges = edge_attacks(repo, files)
        runs += edges
        if edges:
            attacked.append(f'{len(edges)} edge probes: --help, empty input, a missing path')
        landed = on_base_tests(repo, base, tests, args.timeout) if not args.no_base else None
        if landed is not None:
            runs += landed
            attacked.append(f'touched tests on a fresh {base} after landing')
        decl = declared_attacks(repo, head)
        runs += [{'what': d['what'], 'ok': d['ok'], 'detail': ' | '.join(d.get('tail', [])[-2:]) if not d['ok'] else ''}
                 for d in decl]
        if decl:
            attacked.append(f'{len(decl)} declared attacks')
        if not decl:
            breaks.append({'kind': 'no-declared-attack', 'where': '',
                           'detail': 'no `break-it attack` ran on this HEAD: try the real example, an empty or '
                                     'bad input, and a second client or config before calling it done'})
    for r in runs:
        if not r['ok']:
            breaks.append({'kind': 'attack-broke', 'where': r['what'], 'detail': r['detail'] or r['what']})

    previous = latest_receipt(repo) if repo else None
    now_keys = {break_key(b) for b in breaks}
    fixed = []
    if previous and previous.get('head') != head or (previous and previous.get('dirty') != dirty):
        fixed = [b for b in previous.get('open', []) if break_key(b) not in now_keys]
    open_breaks = [b for b in breaks]
    unreported_ = unreported(open_breaks, reply)

    receipt = {'version': 1, 'mode': 'fast' if args.fast else 'full', 'head': head, 'dirty': dirty,
               'base': base, 'repo': str(repo) if repo else None, 'time': int(time.time()),
               'ask': ask_rows, 'attacked': attacked, 'runs': runs, 'claims': claim_rows,
               'broke': breaks, 'fixed': fixed, 'open': open_breaks}
    if repo and not args.no_write:
        receipt_path(repo, head).write_text(json.dumps(receipt, indent=1))
    if args.json:
        print(json.dumps(dict(receipt, unreported=unreported_), indent=1))
    else:
        print(render(receipt, unreported_))
    return 0 if not unreported_ else 1


def render(r, unreported=()):
    out = [f"break-it ({r['mode']}) on {r['head'][:10] or 'no repo'}{' + uncommitted' if r['dirty'] else ''}"]
    out.append('attacked: ' + '; '.join(r['attacked']))
    counts = {}
    for row in r['ask']:
        counts[row['status']] = counts.get(row['status'], 0) + 1
    if r['ask']:
        out.append('ask: ' + ', '.join(f'{v} {k}' for k, v in counts.items()))
        for row in r['ask']:
            if row['status'] != 'delivered':
                out.append(f"  {row['status']:9} {row['clause'][:110]}")
    if r['fixed']:
        out.append(f"fixed since the last receipt: {len(r['fixed'])}")
        for b in r['fixed'][:8]:
            out.append(f"  {b['kind']}: {b['detail'][:110]}")
    if r['open']:
        out.append(f"still open: {len(r['open'])}")
        for b in r['open'][:15]:
            flag = '  ' if b not in unreported else '! '
            out.append(f"{flag}{b['kind']}: {(b['where'] + ' ') if b['where'] else ''}{b['detail'][:120]}")
    else:
        out.append('nothing broke')
    return '\n'.join(out)


def check(args):
    """Exit 0 when a full receipt matches HEAD and the uncommitted tree, and every
    open break in it is named in the reply."""
    repo = repo_root(args.repo)
    if repo is None:
        # Found by break-it on its own change: this said ok outside a repo,
        # certifying a tree it never looked at.
        print('not a git repository: nothing to certify')
        return 1
    head, dirty = tree_state(repo)
    try:
        r = json.loads(receipt_path(repo, head).read_text())
    except (OSError, ValueError):
        print(f'no break-it receipt for {head[:10]}')
        return 1
    if r.get('dirty') != dirty:
        print(f'the break-it receipt for {head[:10]} predates uncommitted edits')
        return 1
    if r.get('mode') != 'full' and not args.allow_fast:
        print(f'the receipt for {head[:10]} is a fast one: nothing was run against it')
        return 1
    reply = sys.stdin.read() if args.reply == '-' else (Path(args.reply).read_text() if args.reply else '')
    left = unreported(r.get('open', []), reply)
    if left:
        print(f'{len(left)} open break(s) the reply does not mention:')
        for b in left[:8]:
            print(f"  {b['kind']}: {(b['where'] + ' ') if b['where'] else ''}{b['detail'][:120]}")
        return 1
    print(f"receipt ok for {head[:10]}: {len(r.get('open', []))} open, all named")
    return 0


def show(args):
    repo = repo_root(args.repo)
    if repo is None:
        return 1
    head, _ = tree_state(repo)
    try:
        r = json.loads(receipt_path(repo, head).read_text())
    except (OSError, ValueError):
        print(f'no break-it receipt for {head[:10]}')
        return 1
    print(json.dumps(r, indent=1) if args.json else render(r))
    return 0


def claims_done(reply):
    """True when some sentence says the work is finished and the word is not negated."""
    for s in sentences(reply):
        for m in DONE_RE.finditer(s):
            before = s[:m.start()]
            if NEGATED_RE.search(before):
                continue
            # "when it's done", "the done list", a quoted word: not a status.
            if re.search(r'["`\'][^"`\']*$', before) and s[m.end():m.end() + 1] in '"`\'':
                continue
            return True
    return False


# ── the Stop hook's verdict ──────────────────────────────────────────────

# Notes and scratch are not a change to attack. second-brain commits itself
# through brain-sync, and Downloads is where deliverables go.
NOT_WORK = re.compile(r'(/scratchpad/|^/private/tmp/|^/tmp/|Application Support|/\.claude/projects/|'
                      r'/second-brain/|/Downloads/)')
REPO_GUESS = re.compile(r'^(.*?/\.claude/worktrees/[^/]+|.*?/code/(?:work/|personal/)?[^/]+)(?=/)')
COMMIT_RE = re.compile(r'(git commit|chewbacca land|git push|bin/chewbacca land)')


def recap_of(turn):
    """The desktop app's wrap_up recap. The steering study of 2026-10-16 found most
    done claims there, with the text reply often only the prayer."""
    recaps = [' '.join(str(e['input'].get(k, '')) for k in ('recap', 'ask'))
              for e in turn if e['kind'] == 'tool' and e['name'].endswith('wrap_up')]
    return recaps[-1].strip() if recaps else ''


def code_repos(turn, live=True):
    out = {}
    for p in written_paths(turn):
        if NOT_WORK.search(p):
            continue
        root = repo_root(p) if live else None
        if root is None and not live:
            m = REPO_GUESS.match(p)
            root = Path(m.group(1)) if m else None
            # A guessed folder still on disk that is not a repository (zrec-ops
            # is a scratch folder of scripts) is not one in the replay either.
            if root is not None and root.is_dir() and repo_root(root) is None:
                root = None
        if root is not None:
            out.setdefault(str(root), []).append(p)
    return out


def uncommitted(turn, repo, paths, live=True):
    """Files this session wrote that are still not committed. 2026-10-16, a Sabo
    tab: "Saved today's Sabo lessons ... None of it is committed", and Caleb's
    next message was "We're not as goated as we pitched yet"."""
    if live:
        rel = []
        for p in paths:
            try:
                rel.append(str(Path(p).resolve().relative_to(Path(repo).resolve())))
            except (ValueError, OSError):
                continue
        status = git(repo, 'status', '--porcelain', '--', *rel) if rel else ''
        left = [l[3:] for l in (status or '').splitlines() if l.strip()]
    else:
        mine = set(paths)
        last = max((i for i, e in enumerate(turn) if e['kind'] == 'tool' and e['name'] in WRITE_TOOLS
                    and (e['input'].get('file_path') or '') in mine), default=-1)
        done = any(COMMIT_RE.search(command_of(e)) and not e.get('error')
                   for e in turn[last + 1:] if e['kind'] == 'tool')
        left = [] if done else [Path(p).name for p in paths]
    if not left:
        return []
    return [{'kind': 'uncommitted', 'where': ', '.join(left[:4]),
             'detail': f'{len(left)} file(s) this session wrote are not committed'}]


def receipt_ok(repo, reply):
    head, dirty = tree_state(Path(repo))
    try:
        r = json.loads(receipt_path(Path(repo), head).read_text())
    except (OSError, ValueError):
        return False
    return r.get('mode') == 'full' and r.get('dirty') == dirty and not unreported(r.get('open', []), reply)


def stop_verdict(events, reply, live=True, check_disk=True, probe_budget=8):
    """The breaks that refuse a done claim, or [] to let the reply stand. A full
    receipt for this exact tree with every open break named lets it stand."""
    turn = turn_events(events)
    full = ((reply or '') + '\n' + recap_of(turn)).strip()
    if not claims_done(full):
        return []
    repos = code_repos(turn, live)
    out = []
    ask_texts = asks(events)
    for repo, paths in repos.items():
        if live and receipt_ok(repo, full):
            continue
        base = base_ref(Path(repo), None) if live else None
        found = fast_findings(turn, full, ask_texts, Path(repo), base, check_disk)
        found += uncommitted(turn, repo, paths, live)
        if live and probe_budget and trusted_repo(repo):
            rel = []
            for p in paths:
                try:
                    rel.append(str(Path(p).resolve().relative_to(Path(repo).resolve())))
                except (ValueError, OSError):
                    continue
            # 8 s total: the whole next_move.py probe set took 1.1 s at load 150.
            for r in edge_attacks(Path(repo), rel, timeout=6, budget=probe_budget):
                if not r['ok']:
                    found.append({'kind': 'attack-broke', 'where': r['what'], 'detail': r['detail'] or r['what']})
        out += [dict(b, repo=repo) for b in unreported(found, full) if b['kind'] in BLOCKING]
    return out


def cmd_stop(args):
    """Stop-hook entry: the hook payload on stdin, the refusal on stderr, exit 2."""
    try:
        payload = json.loads(sys.stdin.read() or '{}')
    except ValueError:
        return 0
    reply = payload.get('last_assistant_message') or ''
    path = payload.get('transcript_path') or ''
    events = read_transcript(path) if path else []
    if payload.get('agent') == 'codex':
        # Codex's rollout is not Claude JSONL. Its adapter passes the prompt and
        # the repository; the written files come from the repository's status.
        events = [{'kind': 'user', 'text': payload.get('user_message') or '', 'ts': ''}]
        cwd = payload.get('cwd') or '.'
        repo = repo_root(cwd)
        if repo is not None and payload.get('codex_wrote'):
            status = git(repo, 'status', '--porcelain') or ''
            # These paths come from git status, so they may include files the
            # agent never wrote: read them, never run them (probe budget 0).
            for line in status.splitlines():
                events.append({'kind': 'tool', 'name': 'Edit', 'id': None, 'error': False, 'ts': '',
                               'input': {'file_path': str(repo / line[3:].strip())}})
            if payload.get('codex_evidence_after_write'):
                events.append({'kind': 'tool', 'name': 'Bash', 'id': None, 'error': False, 'ts': '',
                               'input': {'command': 'codex verified run'}})
    breaks = stop_verdict(events, reply, probe_budget=0 if payload.get('agent') == 'codex' else 8)
    if not breaks:
        return 0
    lines = ['', 'break-it: this reply says the work is done, and attacking it found what the reply',
             'does not say:', '']
    for b in breaks[:8]:
        lines.append(f"  - {b['kind']}: {(b['where'] + ': ') if b['where'] else ''}{b['detail'][:150]}")
    lines += ['',
              'Caleb, 2026-10-16: "When they build something and say it\'s done, chewbs should',
              'attack it from every angle trying to break it before it concludes anything".',
              '',
              'The reply is already on his screen, so do NOT repeat it. Fix what broke, or run',
              '`chewbacca break-it run --transcript <this transcript>` after recording your own',
              'attacks with `chewbacca break-it attack -m "<what>" -- <command>`, then add one',
              'short line: what broke, what you fixed, what is still open.']
    print('\n'.join(lines), file=sys.stderr)
    return 2


def main(argv=None):
    p = argparse.ArgumentParser(prog='break-it', description=__doc__.split('\n\n')[0])
    sub = p.add_subparsers(dest='cmd')
    r = sub.add_parser('run', help='attack the current change and write a receipt bound to HEAD')
    r.add_argument('--repo', default='.')
    r.add_argument('--transcript', help='the session transcript (Claude Code JSONL)')
    r.add_argument('--ask', help='the ask, when there is no transcript (Codex passes its prompt)')
    r.add_argument('--reply', help='the draft recap: a file, or - for stdin')
    r.add_argument('--base', help='the branch it lands on (default origin/main)')
    r.add_argument('--fast', action='store_true', help='no test runs or probes: the ask, diff and claims only')
    r.add_argument('--no-base', action='store_true', help='skip the rerun on a fresh base worktree')
    r.add_argument('--timeout', type=int, default=240)
    r.add_argument('--no-write', action='store_true')
    r.add_argument('--json', action='store_true')
    a = sub.add_parser('attack', help='run one adversarial check and record it for this HEAD')
    a.add_argument('-m', '--message', required=True, help='what this attacks, in plain words')
    a.add_argument('--expect', choices=('ok', 'fail'), default='ok',
                   help='fail: the command SHOULD be refused (bad input, a dangerous path)')
    a.add_argument('--repo', default='.')
    a.add_argument('--timeout', type=int, default=240)
    a.add_argument('command', nargs=argparse.REMAINDER)
    c = sub.add_parser('check', help='exit 0 when a full receipt matches this tree')
    c.add_argument('--repo', default='.')
    c.add_argument('--reply', help='the reply, a file or -; open breaks it names are allowed')
    c.add_argument('--allow-fast', action='store_true')
    sub.add_parser('stop', help='Stop-hook entry: reads the hook payload on stdin')
    s = sub.add_parser('show', help='print the receipt for HEAD')
    s.add_argument('--repo', default='.')
    s.add_argument('--json', action='store_true')
    args = p.parse_args(argv)
    if args.cmd == 'run':
        return run(args)
    if args.cmd == 'attack':
        return cmd_attack(args)
    if args.cmd == 'check':
        return check(args)
    if args.cmd == 'stop':
        return cmd_stop(args)
    if args.cmd == 'show':
        return show(args)
    p.print_help()
    return 2


if __name__ == '__main__':
    sys.exit(main())
