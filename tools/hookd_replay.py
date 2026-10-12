#!/usr/bin/env python3
"""Replay real tool calls from Claude Code transcripts through the hooks.

Two checks, both read-only on the transcripts:

  parity    For every guard with a `# gate:` header, every real Bash call that
            `hookd decide` would skip is run through the guard itself, which
            must exit 0 and print nothing. One mismatch fails the run: the gate
            would have let something past a guard.
  refusals  Count, per hook, how often it actually refused in the transcripts
            (the host writes "PreToolUse:Bash hook error: [<hook>]: ..." into
            the tool result), with samples, so false positives can be judged
            on real calls instead of imagined ones.

  corpus    Write a sanitized sample of real Bash shapes to a fixture, so the
            parity check runs in the suite without anyone's transcripts.

    hookd_replay.py parity --days 7 [--limit 400] [--hookd PATH]
    hookd_replay.py parity --corpus tests/fixtures/hookd-replay/bash.jsonl [--only NAME] [--jobs 4] [--fail-fast]
    hookd_replay.py refusals --days 7 [--samples 5] [--json]
    hookd_replay.py corpus --days 7 --out tests/fixtures/hookd-replay/bash.jsonl
"""
import argparse
import collections
from concurrent.futures import ThreadPoolExecutor
import heapq
import json
import os
from pathlib import Path
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = Path.home() / '.claude/projects'


def transcripts(days, root=PROJECTS):
    cutoff = time.time() - days * 86400
    for path in root.rglob('*.jsonl'):
        try:
            if path.stat().st_mtime >= cutoff:
                yield path
        except OSError:
            continue


def bash_calls(days, root=PROJECTS):
    """(payload, transcript) for every Bash tool_use in recent transcripts."""
    seen = set()
    for path in transcripts(days, root):
        try:
            lines = path.read_text(errors='replace').splitlines()
        except OSError:
            continue
        for line in lines:
            if '"tool_use"' not in line or '"Bash"' not in line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            content = ((row.get('message') or {}).get('content')) or []
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get('type') != 'tool_use' or block.get('name') != 'Bash':
                    continue
                data = block.get('input') or {}
                command = data.get('command')
                if not isinstance(command, str) or command in seen:
                    continue
                seen.add(command)
                yield {'session_id': 'hookd-replay', 'hook_event_name': 'PreToolUse',
                       'tool_name': 'Bash', 'tool_use_id': block.get('id') or '',
                       'cwd': row.get('cwd') or str(Path.home()),
                       'tool_input': data}, path


def gated_hooks(hooks_dir):
    return sorted(p for p in Path(hooks_dir).glob('*.sh')
                  if re.search(r'^# gate:', p.read_text(errors='replace'), re.M))


def decide(hookd, script, payload):
    result = subprocess.run([hookd, 'decide', str(script)], input=json.dumps(payload),
                            text=True, capture_output=True, timeout=10)
    return result.stdout.strip()


def corpus_calls(path):
    """Payloads from a corpus fixture: one {"command", "cwd"} object a line."""
    calls = []
    for line in Path(path).read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        cwd = os.path.expanduser(row.get('cwd') or '~')
        calls.append({'session_id': 'hookd-replay', 'hook_event_name': 'PreToolUse',
                      'tool_name': 'Bash', 'tool_use_id': '', 'cwd': cwd,
                      'tool_input': {'command': row['command']}})
    return calls


def run_body(script, payload, env):
    """The guard's body on one call: (exit, output)."""
    result = subprocess.run(['bash', str(script)], input=json.dumps(payload), text=True,
                            capture_output=True, env=env, timeout=30,
                            cwd=payload['cwd'] if os.path.isdir(payload['cwd']) else None)
    return result.returncode, (result.stdout + result.stderr).strip()


def replay_one(script, payload, env):
    """Run the guard's body on one call the gate would skip; a dict if it acted.

    A call the guard acts on is run a second time. A missing gate word acts
    every time, since it is a grep on the command text; a call that acts once
    and then not again is the machine, not the gate. On 2026-10-12 at load 19
    submit-guard printed from lib.sh on 4 of 755 calls in one run and on 0 of
    755 in three reruns and 700 direct runs. It is reported, not failed."""
    code, out = run_body(script, payload, env)
    if code == 0 and not out:
        return None
    again = run_body(script, payload, env)
    return {'hook': script.name, 'command': payload['tool_input'].get('command', '')[:300],
            'exit': code, 'out': out[:600], 'flaky': again == (0, '')}


def parity(args):
    hooks = gated_hooks(args.hooks)
    if args.only:
        hooks = [h for h in hooks if h.name in args.only]
        missing = set(args.only) - {h.name for h in hooks}
        if missing:
            raise SystemExit(f'not a gated guard in {args.hooks}: {", ".join(sorted(missing))}')
    if args.corpus:
        calls = corpus_calls(args.corpus)
    else:
        calls = [payload for payload, _ in bash_calls(args.days)]
        random.Random(11).shuffle(calls)
    scratch = tempfile.mkdtemp(prefix='hookd-replay-')
    # HOOKD_INNER: the guard runs its own body. Without it a guard's first
    # line would hand the call back to hookd and every replay would pass.
    env = dict(os.environ, CHEWBACCA_HOME=scratch, HOOKD_LOG='off', HOOKD_INNER='1',
               CHEWBACCA_LOG_DIR=os.path.join(scratch, 'logs'))
    failures, flaky, report = [], [], {}
    for script in hooks:
        batch = subprocess.run([args.hookd, 'decide', str(script), '--jsonl'],
                               input='\n'.join(json.dumps(p) for p in calls) + '\n',
                               text=True, capture_output=True, timeout=600).stdout.split()
        if len(batch) != len(calls):
            raise SystemExit(f'hookd decided {len(batch)} of {len(calls)} calls for {script.name}')
        skipped = [p for p, verdict in zip(calls, batch) if verdict == 'skip']
        todo = skipped[:args.limit]
        found = []
        with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
            for miss in pool.map(lambda p: None if (args.fail_fast and found) else replay_one(script, p, env), todo):
                if miss and miss['flaky']:
                    flaky.append(miss)
                elif miss:
                    found.append(miss)
        failures.extend(found)
        report[script.name] = {'calls': len(calls), 'skip': len(skipped), 'run': len(calls) - len(skipped),
                               'replayed': len(todo)}
        if args.fail_fast and failures:
            break
    shutil.rmtree(scratch, ignore_errors=True)
    out = {'days': None if args.corpus else args.days, 'corpus': args.corpus, 'hooks': report, 'mismatches': failures, 'flaky': flaky}
    if args.json:
        print(json.dumps(out, indent=1))
    else:
        source = f'corpus {args.corpus}' if args.corpus else f'last {args.days} days'
        print(f'{len(calls)} distinct real Bash calls, {source}')
        for name, row in report.items():
            print(f'  {name:28} skip {row["skip"]:5}  run {row["run"]:5}  replayed {row["replayed"]:4}')
        print(f'mismatches: {len(failures)}')
        for f in flaky[:20]:
            print('   flaky, acted once and not on a rerun:', f['hook'], f['exit'], f['command'][:80].replace('\n', ' '),
                  '->', f['out'][:200].replace('\n', ' '))
        for f in failures[:20]:
            print('  ', f['hook'], f['exit'], f['command'][:120].replace('\n', ' '), '->', f['out'][:120].replace('\n', ' '))
    return 1 if failures else 0


# What the corpus may hold: short calls with nothing personal in them. 400
# chars and 4 lines kept 23,224 of 35,834 real calls on 2026-10-12; longer
# ones are mostly heredoc prose and inline scripts, not command shapes.
CORPUS_MAX_CHARS = 400
CORPUS_MAX_LINES = 4
# How many calls the fixture keeps, picked greedily to cover the words real
# calls use. Measured 2026-10-12 over 12,484 clean calls: 400 covered 80% of
# the words seen in 5+ calls, 800 covered 96%, 1200 covered 99.4% at 50% more
# replay time. A guard change replays ~800 calls in about 20 s at 4 jobs.
CORPUS_SIZE = 800
# Anything that reads as a person's data is dropped, never redacted: a
# redaction can miss, a dropped line cannot leak.
PERSONAL = re.compile(
    r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}'      # an email address
    r'|\+\d{7,15}\b|\b\d{3}[ .-]\d{3}[ .-]\d{4}\b|\b\d{10,}\b'  # a phone number or long id
    r'|\b(?:sk-|pk_|rk_|ghp_|gho_|ghs_|github_pat_|xox[abprs]-|AKIA|AIza|ya29\.)[A-Za-z0-9_-]{8,}'  # a key
    r'|(?=[A-Za-z0-9_+=-]*\d)(?=[A-Za-z0-9_+=-]*[A-Za-z])[A-Za-z0-9_+=-]{32,}'  # a token or hash
    r'|https?://\S*[?#]'                                    # a URL carrying a query
    r'|<<'                                                   # a heredoc body
    # A grep list of five or more terms is how a search for names or private
    # topics looks: the 10/12 first cut carried one listing family names.
    r'|(?:[^|\s"\'(]+\\?\|){4,}[^|\s"\')]+'
    r'|PRIVATE KEY|passw(?:or)?d\s*[=:]|hunter2'
    r'|bipolar|diagnos|manic|hospital|medicat|psychiat|girlfriend|relationship|therap'
    r'|second-brain|coursework|school|Downloads|Desktop|Documents|Pictures|Photos'
    r'|Library/Messages|chat\.db|/personal/|\.claude/projects|billing'
    r'|\b\d{3,5} [A-Z][a-z]{3,}|publicId=|facetime|calls\.py|lessons why|granola|CallHistory'  # an address, a profile
    r'|\b(?:messages|mail|gmail|imessage|whatsapp|wacli|beeper|slack|contacts|calendar'
    r'|reminders|notes|texts?|send|draft|people|brief|resolve|phone|email)\b',
    re.I)
HOME_PATH = re.compile(r'/Users/[^/\s\'"]+')
WORD = re.compile(r'[a-z][a-z0-9._-]{2,}')


def pick_covering(commands, size):
    """Greedy cover: each pick adds the most not-yet-covered word mass.

    A trigger a guard gains is a word; the replay catches it only if some
    corpus call holds that word. Weighting each word by how many real calls
    hold it makes the fixture catch the triggers real calls would hit."""
    words = [set(WORD.findall(c.lower())) for c in commands]
    weight = collections.Counter(w for ws in words for w in ws)
    covered, chosen = set(), []
    heap = [(-sum(weight[w] for w in ws), i) for i, ws in enumerate(words)]
    heapq.heapify(heap)
    while heap and len(chosen) < size:
        stale, i = heapq.heappop(heap)
        gain = sum(weight[w] for w in words[i] - covered)
        if gain == 0:
            continue
        if -stale != gain:
            heapq.heappush(heap, (-gain, i))
            continue
        chosen.append(i)
        covered |= words[i]
    return chosen


def corpus(args):
    seen, commands, cwds = set(), [], []
    for payload, _ in bash_calls(args.days):
        command = payload['tool_input'].get('command', '')
        if len(command) > CORPUS_MAX_CHARS or command.count('\n') >= CORPUS_MAX_LINES:
            continue
        if PERSONAL.search(command) or PERSONAL.search(payload['cwd']):
            continue
        command = HOME_PATH.sub('~', command)
        if command in seen:
            continue
        seen.add(command)
        cwd = HOME_PATH.sub('~', payload['cwd'])
        commands.append(command)
        cwds.append(cwd if cwd.startswith('~') else '~')
    picked = sorted(pick_covering(commands, args.size), key=lambda i: commands[i])
    text = ''.join(json.dumps({'command': commands[i], 'cwd': cwds[i]}, ensure_ascii=False) + '\n' for i in picked)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(text)
    print(f'{len(picked)} of {len(commands)} clean calls -> {args.out}')
    return 0


REFUSAL = re.compile(r'(PreToolUse|PostToolUse|Stop|UserPromptSubmit)(?::(\w+))? hook error: \[([^\]]+)\]: ?(.*)', re.S)


def refusals(args):
    counts, samples = {}, {}
    for path in transcripts(args.days):
        pending = {}
        try:
            lines = path.read_text(errors='replace').splitlines()
        except OSError:
            continue
        for line in lines:
            if '"tool_use"' in line:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                for block in ((row.get('message') or {}).get('content') or []):
                    if isinstance(block, dict) and block.get('type') == 'tool_use':
                        pending[block.get('id')] = block
            if 'hook error' not in line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            for block in ((row.get('message') or {}).get('content') or []):
                if not isinstance(block, dict) or block.get('type') != 'tool_result':
                    continue
                text = block.get('content')
                if isinstance(text, list):
                    text = ' '.join(str(part.get('text', '')) for part in text if isinstance(part, dict))
                match = REFUSAL.search(str(text or ''))
                if not match:
                    continue
                hook = Path(match.group(3).split()[0]).name
                counts[hook] = counts.get(hook, 0) + 1
                call = pending.get(block.get('tool_use_id')) or {}
                samples.setdefault(hook, []).append({
                    'transcript': str(path), 'tool': call.get('name'),
                    'input': json.dumps(call.get('input')),
                    'reason': match.group(4)[:240]})
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    if args.json:
        print(json.dumps({'counts': dict(ranked), 'samples': samples}, indent=1))
        return 0
    for hook, n in ranked:
        print(f'{n:5}  {hook}')
        for sample in samples[hook][:args.samples]:
            print('       ', (sample['input'] or '')[:150].replace('\n', ' '))
            print('         ->', sample['reason'][:120].replace('\n', ' '))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest='mode', required=True)
    p = sub.add_parser('parity')
    p.add_argument('--days', type=float, default=7)
    # 400 per guard: at ~70 ms a guard run, 10 guards replay in ~5 minutes
    # of CPU, and a word a guard needs but its header lacks shows up within
    # the first few dozen calls that contain it.
    p.add_argument('--limit', type=int, default=400)
    p.add_argument('--hooks', default=str(ROOT / '.claude/hooks'))
    p.add_argument('--hookd', default=shutil.which('hookd') or str(ROOT / 'crates/hookd/target/release/hookd'))
    p.add_argument('--json', action='store_true')
    p.add_argument('--corpus', help='replay a fixture instead of the transcripts')
    p.add_argument('--only', action='append', help='one gated guard by file name; repeatable')
    p.add_argument('--jobs', type=int, default=1)
    p.add_argument('--fail-fast', action='store_true')
    c = sub.add_parser('corpus')
    c.add_argument('--days', type=float, default=7)
    c.add_argument('--size', type=int, default=CORPUS_SIZE)
    c.add_argument('--out', default=str(ROOT / 'tests/fixtures/hookd-replay/bash.jsonl'))
    r = sub.add_parser('refusals')
    r.add_argument('--days', type=float, default=7)
    r.add_argument('--samples', type=int, default=5)
    r.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    return {'parity': parity, 'refusals': refusals, 'corpus': corpus}[args.mode](args)


if __name__ == '__main__':
    raise SystemExit(main())
