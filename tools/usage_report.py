#!/usr/bin/env python3
"""chewbacca usage: what in the kit actually gets used, counted, never hoped.

    chewbacca usage [--days 30] [--json] [--save] [--no-cache]
    chewbacca usage --daily        fold the verdict log into the rollup, and
                                   write the weekly report when it's due

Caleb, 2026-10-13, asked what he uses: "I would hope that everything is being
used". The boundary audit that afternoon found 44 of 138 skills unloaded in 30
days, by reading 6,988 transcripts by hand. This makes that a command.

Every skill, `chewbacca` verb, bin tool, slash command and registered hook gets
a row with what used it:

  loads     the Skill tool, or a SKILL.md read (Claude Code and Codex transcripts)
  routed    the skill router showed it on a prompt (verdict log)
  calls     a shell call that ran it (transcripts), plus jobs queued for it
  runs      times a hook ran, and refusals, from the verdict log
  refused   hook refusals the agent saw (transcripts, the full window)

WHERE THE NUMBERS COME FROM, AND WHERE THEY STOP. Transcripts cover the whole
window. The verdict log rotates at 8 MB and keeps eight days of parts
(.claude/hooks/lib.sh), and it only exists since 2026-10-12, so hook runs and
router counts cover what the rollup has seen: every run folds new rows into
~/.chewbacca/state/usage/verdicts.json, and the daily service keeps that ahead
of the eight-day delete. The report prints how many days each source covers,
so a 2-day hook count never reads as a 30-day one.

Rows from test runs are dropped: a hook-running test file run outside
tests/run.sh writes to the real log under a session named "s" or no UUID at
all (REPORT-boundary-guards: attribution-guard showed 5,846 runs that way).

Read only. It writes its own cache, rollup and reports, nothing else.
Runs on /usr/bin/python3 3.9.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import verdicts  # noqa: E402

DAY_S = 86400
# hookd_replay's due() rule: write on a Sunday, or once the newest report is a
# week old, so a Mac asleep all Sunday still gets its week.
WEEK_S = 7 * DAY_S
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
SKILL_READ = re.compile(r'/([\w.-]+)/SKILL\.md\b')
SLASH = re.compile(r'<command-name>/?([\w:.-]+)</command-name>')
# The same refusal shape tools/hookd_replay.py reads: "PreToolUse:Bash hook
# error: [<hook command>]: <reason>". The guard is named by the reason's first
# word when the command lists several (a hookd dispatch line lists 13).
REFUSAL = re.compile(r'\s*(PreToolUse|PostToolUse|Stop|UserPromptSubmit)(?::(\w+))? hook error: \[(.+?)\]: ?(.*)', re.S)
SCRIPT = re.compile(r'[\w./~$-]+\.(?:sh|py|js|mjs)\b')
HOOK_FILE = re.compile(r'hooks/([\w.-]+\.(?:sh|py|js|mjs))\b')
CODEX_CMD = re.compile(r'cmd:\s*"((?:[^"\\]|\\.)*)"')
SEGMENT = re.compile(r'\s*(?:&&|\|\||;|\||\n)\s*')
ENV_WORD = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*=')
WRAPPERS = {'sudo', 'nice', 'time', 'env', 'exec', 'command', 'nohup', 'caffeinate', 'timeout'}
# A transcript line worth parsing names a tool call, a slash command or a
# hook's refusal. Everything else (text, results, metadata) is most of the
# 3.6 GB and is skipped on a substring test before json.loads.
WANT = ('"tool_use"', 'command-name', 'hook error', '"function_call"', '"custom_tool_call"',
        'hook_blocking_error')
BLOCKING = re.compile(r'\s*\[(.+?)\]: ?(.*)', re.S)


def home():
    return Path(os.path.expanduser('~'))


def kit_home():
    return Path(os.environ.get('CHEWBACCA_HOME') or home() / '.chewbacca').expanduser()


def state_dir():
    return kit_home() / 'state' / 'usage'


def day_of(epoch):
    return datetime.datetime.fromtimestamp(epoch).strftime('%Y-%m-%d')


def iso_day(stamp):
    """'2026-10-13T05:01:02.000Z' as a local day, or '' when unreadable."""
    try:
        moment = datetime.datetime.strptime(stamp[:19], '%Y-%m-%dT%H:%M:%S')
    except (TypeError, ValueError):
        return ''
    utc = moment.replace(tzinfo=datetime.timezone.utc)
    return utc.astimezone().strftime('%Y-%m-%d')


# ---------------------------------------------------------------- inventory

def skill_source(path, root):
    try:
        real = Path(os.path.realpath(path))
    except OSError:
        real = Path(path)
    text = str(real)
    if text.startswith(str(Path(os.path.realpath(root)) / 'skills')) or '/.chewbacca/kit/' in text \
            or '/code/chewbacca/skills/' in text:
        return 'kit'
    parts = real.parts
    if 'skills' in parts[:-1]:
        index = len(parts) - 1 - list(reversed(parts[:-1])).index('skills') - 1
        if index >= 1 and parts[index - 1] not in ('.claude', '.chewbacca', '.agents', '.codex'):
            return parts[index - 1]
    return 'local'


def skills(root):
    """name -> source, from every folder an agent loads skills from."""
    found = {}
    dirs = [Path(root) / 'skills', home() / '.claude/skills', kit_home() / 'skills',
            home() / '.agents/skills']
    for base in dirs:
        if not base.is_dir():
            continue
        for entry in sorted(base.iterdir()):
            if entry.name.startswith('.') or not (entry / 'SKILL.md').exists():
                continue
            found.setdefault(entry.name, skill_source(entry, root))
    return found


def verbs(root):
    """Every `chewbacca <verb>`: the help table plus the case labels below it."""
    path = Path(root) / 'bin/chewbacca'
    try:
        text = path.read_text(errors='replace')
    except OSError:
        return set()
    names = set(re.findall(r'^\s*"([a-z][\w-]*)\|', text, re.M))
    for label in re.findall(r'^([a-z][\w|-]*)\)', text, re.M):
        names.update(part for part in label.split('|') if part)
    return names


def bin_tools(root):
    base = Path(root) / 'bin'
    if not base.is_dir():
        return set()
    return {p.name for p in base.iterdir()
            if p.is_file() and not p.name.startswith('.') and os.access(p, os.X_OK) and p.name != 'chewbacca'}


def slash_commands(root):
    names = set()
    for base in (Path(root) / '.claude/commands', home() / '.claude/commands'):
        if base.is_dir():
            names.update(p.stem for p in base.glob('*.md'))
    return names


def hooks():
    """hook file -> {'events', 'logged'}, from ~/.claude/settings.json. A
    hook is logged when hookd runs it (hookd writes the row) or its script
    writes rows itself through lib.sh or verdicts.py; anything else runs
    without a trace, so its zero means unknown, never unused."""
    out = {}
    try:
        settings = json.loads((home() / '.claude/settings.json').read_text())
    except (OSError, ValueError):
        return out
    for event, groups in (settings.get('hooks') or {}).items():
        for group in groups or []:
            for hook in (group or {}).get('hooks') or []:
                command = str((hook or {}).get('command') or '')
                for name in HOOK_FILE.findall(command):
                    entry = out.setdefault(name, {'events': set(), 'logged': False})
                    entry['events'].add(event)
                    if 'hookd' in command or writes_verdicts(home() / '.claude/hooks' / name):
                        entry['logged'] = True
    return out


def writes_verdicts(path):
    try:
        text = path.read_text(errors='replace')
    except OSError:
        return False
    # hook_init sets the EXIT trap that writes the row. Sourcing lib.sh alone
    # doesn't: chat-approval and terminal-loop source it and never log.
    return 'hook_init' in text or 'verdicts' in text


# ---------------------------------------------------------------- transcripts

def first_words(command):
    """The program each piece of a shell line runs, and its first argument."""
    out = []
    for piece in SEGMENT.split(command or ''):
        words = piece.strip().lstrip('(').split()
        while words and (ENV_WORD.match(words[0]) or words[0] in WRAPPERS or words[0].startswith('-')):
            words = words[1:]
        if not words:
            continue
        prog = os.path.basename(words[0].strip('"\''))
        if prog in ('python3', 'python', 'bash', 'sh', 'node', 'zsh') and len(words) > 1:
            rest = [w for w in words[1:] if not w.startswith('-')]
            if rest:
                prog = os.path.basename(rest[0].strip('"\''))
                words = [prog] + rest[1:]
        out.append((prog, words[1] if len(words) > 1 else ''))
    return out


def bump(counts, day, kind, name, n=1):
    key = '%s\t%s\t%s' % (day, kind, name)
    counts[key] = counts.get(key, 0) + n


def shell_line(counts, day, command):
    for name in SKILL_READ.findall(command):
        bump(counts, day, 'load', name)
    for prog, arg in first_words(command):
        if prog == 'chewbacca' and arg and not arg.startswith('-'):
            bump(counts, day, 'verb', arg)
        elif prog.endswith(('.py', '.sh', '.js')):
            bump(counts, day, 'tool', prog.rsplit('.', 1)[0])
        else:
            bump(counts, day, 'prog', prog)


def hook_of(command, reason):
    names = [Path(s).name for s in SCRIPT.findall(command)]
    said = re.match(r'\s*(?:BLOCKED by )?([\w.-]+?):', reason or '')
    if said:
        for name in names:
            if Path(name).stem == said.group(1):
                return name
    if len(set(names)) == 1:
        return names[0]
    if said:
        return said.group(1) + '.sh'
    return names[-1] if names else '?'


def result_text(block):
    text = block.get('content')
    if isinstance(text, list):
        text = ' '.join(str(part.get('text', '')) for part in text if isinstance(part, dict))
    return str(text or '')


def claude_row(counts, row):
    day = iso_day(row.get('timestamp') or '')
    if not day:
        return
    attachment = row.get('attachment') or {}
    if row.get('type') == 'attachment' and isinstance(attachment, dict):
        # A Stop or PostToolUse refusal arrives as an attachment, not a tool
        # result: {"blockingError": {"blockingError": "[<command>]: <reason>"}}.
        if attachment.get('type') == 'hook_blocking_error':
            error = attachment.get('blockingError') or {}
            text = error.get('blockingError') if isinstance(error, dict) else error
            match = BLOCKING.match(str(text or ''))
            if match:
                bump(counts, day, 'refused', hook_of(match.group(1), match.group(2)))
        return
    message = row.get('message') or {}
    content = message.get('content')
    if isinstance(content, str):
        if row.get('type') == 'user':
            for name in SLASH.findall(content):
                bump(counts, day, 'slash', name.lstrip('/'))
        return
    if not isinstance(content, list):
        return
    for block in content:
        if not isinstance(block, dict):
            continue
        kind = block.get('type')
        if kind == 'tool_use':
            name, data = block.get('name'), block.get('input') or {}
            if name == 'Skill':
                skill = str(data.get('skill') or '')
                if skill:
                    bump(counts, day, 'load', skill.split(':')[-1])
            elif name == 'Read':
                match = SKILL_READ.search(str(data.get('file_path') or ''))
                if match:
                    bump(counts, day, 'load', match.group(1))
            elif name == 'Bash':
                shell_line(counts, day, str(data.get('command') or ''))
        elif kind == 'tool_result':
            match = REFUSAL.match(result_text(block))
            if match:
                bump(counts, day, 'refused', hook_of(match.group(3), match.group(4)))
        elif kind == 'text' and row.get('type') == 'user':
            for name in SLASH.findall(str(block.get('text') or '')):
                bump(counts, day, 'slash', name.lstrip('/'))


def codex_row(counts, row):
    day = iso_day(row.get('timestamp') or '')
    payload = row.get('payload') or {}
    if not day or payload.get('type') not in ('function_call', 'custom_tool_call'):
        return
    body = str(payload.get('input') or payload.get('arguments') or '')
    for raw in CODEX_CMD.findall(body):
        try:
            command = json.loads('"%s"' % raw)
        except ValueError:
            command = raw
        shell_line(counts, day, command)
    if not CODEX_CMD.search(body):
        try:
            args = json.loads(body)
        except ValueError:
            args = None
        if isinstance(args, dict):
            command = args.get('cmd') or args.get('command') or ''
            if isinstance(command, list):
                command = ' '.join(str(c) for c in command)
            shell_line(counts, day, str(command))


def scan_file(path):
    """Counts for one transcript, keyed 'day\\tkind\\tname'."""
    counts = {}
    codex = '/.codex/' in str(path)
    try:
        with open(path, encoding='utf-8', errors='replace') as fh:
            for line in fh:
                if not any(w in line for w in WANT):
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(row, dict):
                    continue
                (codex_row if codex else claude_row)(counts, row)
    except OSError:
        pass
    return counts


def transcript_files(days):
    cutoff = time.time() - days * DAY_S
    roots = [home() / '.claude/projects', home() / '.codex/sessions']
    for base in roots:
        if not base.is_dir():
            continue
        for path in base.rglob('*.jsonl'):
            try:
                if path.stat().st_mtime >= cutoff:
                    yield path
            except OSError:
                continue


def scan_transcripts(days, use_cache=True):
    """(counts, files read): every transcript touched in the window, each one
    re-read only when its size or mtime changed since the cached pass."""
    cache_path = state_dir() / 'transcripts.json'
    cache = {}
    if use_cache:
        try:
            cache = json.loads(cache_path.read_text())
        except (OSError, ValueError):
            cache = {}
    fresh, total = {}, {}
    for path in transcript_files(days):
        try:
            st = path.stat()
        except OSError:
            continue
        stamp = '%d:%d' % (st.st_size, int(st.st_mtime))
        hit = cache.get(str(path))
        if hit and hit.get('stamp') == stamp:
            counts = hit.get('counts') or {}
        else:
            counts = scan_file(path)
        fresh[str(path)] = {'stamp': stamp, 'counts': counts}
        for key, n in counts.items():
            total[key] = total.get(key, 0) + n
    if use_cache:
        try:
            state_dir().mkdir(parents=True, exist_ok=True)
            tmp = cache_path.with_suffix('.tmp')
            tmp.write_text(json.dumps(fresh))
            os.replace(tmp, cache_path)
        except OSError:
            pass
    return total, len(fresh)


# ---------------------------------------------------------------- verdicts

def real_session(session):
    return not session or bool(UUID.match(session))


def rollup_verdicts():
    """Fold verdict rows newer than the last fold into the daily rollup and
    return it: {'last_ts', 'first_ts', 'days': {day: {key: n}}}."""
    path = state_dir() / 'verdicts.json'
    try:
        state = json.loads(path.read_text())
    except (OSError, ValueError):
        state = {}
    last = int(state.get('last_ts') or 0)
    days = state.get('days') or {}
    first = state.get('first_ts')
    newest = last
    for row in verdicts.rows(since_ms=last + 1 if last else 0):
        if row['ts'] <= last or not real_session(row.get('session') or ''):
            continue
        newest = max(newest, row['ts'])
        first = row['ts'] if first is None else min(first, row['ts'])
        day = days.setdefault(day_of(row['ts'] / 1000), {})
        kind, name, decision = row['kind'], row['name'], row['decision']

        def add(key):
            day[key] = day.get(key, 0) + 1
        if kind == 'hook':
            add('run\t' + name)
            if decision in ('refuse', 'deny', 'block'):
                add('refuse\t' + name)
        elif kind == 'router':
            add('run\t' + name)
            if name == 'skill-route.sh' and decision == 'route':
                shown = re.match(r'shown: ([^;]+)', row.get('reason') or '')
                for skill in (shown.group(1).split(',') if shown else []):
                    if skill.strip():
                        add('routed\t' + skill.strip())
        elif kind == 'send':
            add('send\t%s\t%s' % (name, decision))
    state = {'last_ts': newest, 'first_ts': first, 'days': days}
    try:
        state_dir().mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(state, sort_keys=True))
        os.replace(tmp, path)
    except OSError:
        pass
    return state


# ---------------------------------------------------------------- jobs

def job_name(cmd):
    words = [str(w) for w in cmd or []]
    for i, word in enumerate(words):
        base = os.path.basename(word)
        if base == 'chewbacca' and i + 1 < len(words):
            return 'verb', words[i + 1]
        if base.endswith(('.py', '.sh', '.js')) and ('tools/' in word or 'bin/' in word):
            return 'tool', base.rsplit('.', 1)[0]
        if '/bin/' in word and i == 0 and base not in ('python3', 'bash', 'node', 'sh'):
            return 'prog', base
    for word in words:
        if word.startswith('-') or os.path.basename(word) in ('python3', 'python', 'bash', 'sh', 'node', 'env'):
            continue
        base = os.path.basename(word)
        return ('tool', base.rsplit('.', 1)[0]) if base.endswith(('.py', '.sh', '.js')) else ('prog', base)
    return 'prog', '?'


def jobs(days):
    cutoff = time.time() - days * DAY_S
    counts, total = {}, 0
    base = kit_home() / 'jobs'
    if not base.is_dir():
        return counts, total
    for job in base.glob('*/job.json'):
        try:
            data = json.loads(job.read_text())
        except (OSError, ValueError):
            continue
        if float(data.get('created') or 0) < cutoff:
            continue
        total += 1
        kind, name = job_name(data.get('cmd'))
        key = '%s\t%s' % (kind, name)
        counts[key] = counts.get(key, 0) + 1
    return counts, total


# ---------------------------------------------------------------- report

def window_counts(counts, days, now):
    """Sum 'day\\tkind\\tname' counts to kind -> name -> n within the window."""
    floor = day_of(now - (days - 1) * DAY_S)
    out = {}
    for key, n in counts.items():
        day, kind, name = key.split('\t', 2)
        if day >= floor:
            bucket = out.setdefault(kind, {})
            bucket[name] = bucket.get(name, 0) + n
    return out


def build(root, days=30, use_cache=True, now=None):
    now = now or time.time()
    found_skills = skills(root)
    found_verbs, found_bins, found_slash = verbs(root), bin_tools(root), slash_commands(root)
    found_hooks = hooks()
    raw, files = scan_transcripts(days, use_cache)
    seen = window_counts(raw, days, now)
    state = rollup_verdicts()
    floor = day_of(now - (days - 1) * DAY_S)
    covered = sorted(d for d in state['days'] if d >= floor)
    ver = {}
    for day in covered:
        for key, n in state['days'][day].items():
            kind, name = key.split('\t', 1)
            bucket = ver.setdefault(kind, {})
            bucket[name] = bucket.get(name, 0) + n
    job_counts, job_total = jobs(days)
    by_job = {}
    for key, n in job_counts.items():
        kind, name = key.split('\t', 1)
        by_job.setdefault(kind, {})[name] = n

    loads, routed = seen.get('load', {}), ver.get('routed', {})
    skill_rows = [{'name': name, 'source': source, 'loads': loads.get(name, 0), 'routed': routed.get(name, 0)}
                  for name, source in sorted(found_skills.items())]
    verb_calls = seen.get('verb', {})
    prog_calls, tool_calls = seen.get('prog', {}), seen.get('tool', {})
    verb_rows = [{'name': name, 'calls': verb_calls.get(name, 0), 'jobs': by_job.get('verb', {}).get(name, 0)}
                 for name in sorted(found_verbs)]
    bin_rows = [{'name': name,
                 'calls': prog_calls.get(name, 0) + tool_calls.get(name, 0),
                 'jobs': by_job.get('prog', {}).get(name, 0) + by_job.get('tool', {}).get(name, 0)}
                for name in sorted(found_bins)]
    slash = seen.get('slash', {})
    slash_rows = [{'name': name, 'calls': slash.get(name, 0)} for name in sorted(found_slash)]
    refused, runs, vrefuse = seen.get('refused', {}), ver.get('run', {}), ver.get('refuse', {})

    def either(counts, name):
        # hookd and the routers log some hooks by stem ("model-route"), lib.sh by file name.
        stem = name.rsplit('.', 1)[0]
        return counts.get(name, 0) + (counts.get(stem, 0) if stem != name else 0)
    hook_rows = [{'name': name, 'events': sorted(entry['events']), 'logged': entry['logged'],
                  'runs': either(runs, name), 'refusals_logged': either(vrefuse, name),
                  'refused_seen': either(refused, name)}
                 for name, entry in sorted(found_hooks.items())]
    known = set(found_hooks) | {n.rsplit('.', 1)[0] for n in found_hooks}
    unregistered = sorted(n for n in runs if n not in known)
    return {
        'generated': datetime.datetime.fromtimestamp(now).strftime('%Y-%m-%d %H:%M'),
        'days': days,
        'coverage': {'transcripts': files, 'verdict_days': len(covered),
                     'verdict_from': covered[0] if covered else None, 'jobs': job_total},
        'skills': skill_rows, 'verbs': verb_rows, 'bin': bin_rows, 'slash': slash_rows,
        'hooks': hook_rows, 'hooks_unregistered_in_log': unregistered,
        'sends': ver.get('send', {}),
        'top_jobs': sorted(({'name': k.split('\t', 1)[1], 'jobs': n} for k, n in job_counts.items()),
                           key=lambda r: -r['jobs'])[:10],
    }


def untouched(rows, *fields):
    return [r['name'] for r in rows if not any(r.get(f) for f in fields)]


def summary(report):
    s = report['skills']
    return {
        'skills': len(s), 'skills_loaded': sum(1 for r in s if r['loads']),
        'skills_untouched': len(untouched(s, 'loads', 'routed')),
        'skills_routed_never_loaded': sum(1 for r in s if r['routed'] and not r['loads']),
        'verbs': len(report['verbs']), 'verbs_untouched': len(untouched(report['verbs'], 'calls', 'jobs')),
        'bin': len(report['bin']), 'bin_untouched': len(untouched(report['bin'], 'calls', 'jobs')),
        'slash': len(report['slash']), 'slash_untouched': len(untouched(report['slash'], 'calls')),
        'hooks': len(report['hooks']),
        'hooks_silent': len(untouched([r for r in report['hooks'] if r['logged']], 'runs', 'refused_seen')),
        'hooks_unlogged': sum(1 for r in report['hooks'] if not r['logged']),
        'hook_runs': sum(r['runs'] for r in report['hooks']),
        'hook_refusals_seen': sum(r['refused_seen'] for r in report['hooks']),
    }


def top(rows, field, n=15):
    return sorted((r for r in rows if r[field]), key=lambda r: (-r[field], r['name']))[:n]


def names_line(names):
    return ', '.join(names) if names else 'none'


def markdown(report):
    s, c, days = summary(report), report['coverage'], report['days']
    out = ['# What got used, last %d days' % days, '',
           'Generated %s by `chewbacca usage`.' % report['generated'], '',
           'Sources: %d transcripts (Claude Code and Codex) for the full window; '
           'the verdict log for %d day%s%s (hook runs and skill routing); %d jobs from the queue.'
           % (c['transcripts'], c['verdict_days'], '' if c['verdict_days'] == 1 else 's',
              ' since %s' % c['verdict_from'] if c['verdict_from'] else '', c['jobs']), '',
           '- Skills: %d of %d loaded at least once, %d never loaded or routed, %d routed but never loaded'
           % (s['skills_loaded'], s['skills'], s['skills_untouched'], s['skills_routed_never_loaded']),
           '- chewbacca verbs: %d of %d never run' % (s['verbs_untouched'], s['verbs']),
           '- bin tools: %d of %d never run' % (s['bin_untouched'], s['bin']),
           '- Slash commands: %d of %d never typed' % (s['slash_untouched'], s['slash']),
           '- Hooks: %d registered, %d runs and %d refusals an agent saw; %d never ran in the logged days, '
           '%d write no verdict rows so their runs are unknown'
           % (s['hooks'], s['hook_runs'], s['hook_refusals_seen'], s['hooks_silent'], s['hooks_unlogged']), '']
    out += ['## Skills', '', 'Most loaded:', '']
    out += ['- %s (%s): %d loads, routed %d' % (r['name'], r['source'], r['loads'], r['routed'])
            for r in top(report['skills'], 'loads')]
    out += ['', 'Routed but never loaded: ' + names_line(
        ['%s (%d)' % (r['name'], r['routed']) for r in report['skills'] if r['routed'] and not r['loads']]), '']
    by_source = {}
    for name in untouched(report['skills'], 'loads', 'routed'):
        source = next(r['source'] for r in report['skills'] if r['name'] == name)
        by_source.setdefault(source, []).append(name)
    out += ['Nobody touched:', '']
    out += ['- %s: %s' % (source, ', '.join(names)) for source, names in sorted(by_source.items())]
    out += ['', '## chewbacca verbs', '']
    out += ['- %s: %d calls, %d jobs' % (r['name'], r['calls'], r['jobs']) for r in top(report['verbs'], 'calls')]
    out += ['', 'Never run: ' + names_line(untouched(report['verbs'], 'calls', 'jobs')), '']
    out += ['## bin tools', '']
    out += ['- %s: %d calls, %d jobs' % (r['name'], r['calls'], r['jobs']) for r in top(report['bin'], 'calls')]
    out += ['', 'Never run: ' + names_line(untouched(report['bin'], 'calls', 'jobs')), '']
    out += ['## Slash commands', '']
    out += ['- /%s: %d' % (r['name'], r['calls']) for r in top(report['slash'], 'calls')]
    out += ['', 'Never typed: ' + names_line(untouched(report['slash'], 'calls')), '']
    out += ['## Hooks', '', 'Runs and refusals logged cover %d day%s; refusals seen cover all %d.'
            % (c['verdict_days'], '' if c['verdict_days'] == 1 else 's', days), '']
    for r in sorted(report['hooks'], key=lambda r: (-r['refused_seen'], -r['runs'], r['name'])):
        out.append('- %s (%s): %d runs, %d refusals logged, %d refusals seen'
                   % (r['name'], ', '.join(r['events']), r['runs'], r['refusals_logged'], r['refused_seen']))
    logged = [r for r in report['hooks'] if r['logged']]
    out += ['', 'Never ran in the logged days (each calls hook_init, so a run writes a row unless it '
            'leaves through an exec or its own EXIT trap): '
            + names_line(untouched(logged, 'runs', 'refused_seen'))]
    out += ['', 'Write no verdict rows, so a zero here means unknown: '
            + names_line([r['name'] for r in report['hooks'] if not r['logged']])]
    if report['hooks_unregistered_in_log']:
        out += ['', 'In the verdict log but not registered in settings (other runtimes, tests or retired): '
                + ', '.join(report['hooks_unregistered_in_log'])]
    if report['top_jobs']:
        out += ['', '## Jobs queue', '']
        out += ['- %s: %d' % (r['name'], r['jobs']) for r in report['top_jobs']]
    return '\n'.join(out) + '\n'


def reports_dir():
    return kit_home() / 'reports' / 'usage'


def due(now, folder):
    stamp = datetime.datetime.fromtimestamp(now)
    if (folder / ('%s.md' % stamp.strftime('%Y-%m-%d'))).exists():
        return False
    newest = max((p.stat().st_mtime for p in folder.glob('*.md')), default=0) if folder.is_dir() else 0
    return stamp.weekday() == 6 or now - newest >= WEEK_S


def save(text, now):
    folder = reports_dir()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / ('%s.md' % datetime.datetime.fromtimestamp(now).strftime('%Y-%m-%d'))
    path.write_text(text)
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(prog='chewbacca usage', description=__doc__.split('\n')[0])
    parser.add_argument('--days', type=int, default=30)
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--save', action='store_true', help='also write ~/.chewbacca/reports/usage/<date>.md')
    parser.add_argument('--daily', action='store_true',
                        help='fold the verdict log; write the weekly report only when due')
    parser.add_argument('--no-cache', action='store_true', help='re-read every transcript')
    parser.add_argument('--root', default=str(ROOT), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    now = time.time()
    if args.daily:
        rollup_verdicts()
        if not due(now, reports_dir()):
            return 0
        path = save(markdown(build(args.root, args.days, not args.no_cache, now)), now)
        print(path)
        return 0
    report = build(args.root, args.days, not args.no_cache, now)
    if args.json:
        print(json.dumps(dict(report, summary=summary(report)), indent=1))
    else:
        text = markdown(report)
        sys.stdout.write(text)
        if args.save:
            print('saved: %s' % save(text, now), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
