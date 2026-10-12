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

    hookd_replay.py parity --days 7 [--limit 400] [--hookd PATH]
    hookd_replay.py refusals --days 7 [--samples 5] [--json]
"""
import argparse
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


def parity(args):
    hooks = gated_hooks(args.hooks)
    calls = [payload for payload, _ in bash_calls(args.days)]
    random.Random(11).shuffle(calls)
    scratch = tempfile.mkdtemp(prefix='hookd-replay-')
    # HOOKD_INNER: the guard runs its own body. Without it a guard's first
    # line would hand the call back to hookd and every replay would pass.
    env = dict(os.environ, CHEWBACCA_HOME=scratch, HOOKD_LOG='off', HOOKD_INNER='1',
               CHEWBACCA_LOG_DIR=os.path.join(scratch, 'logs'))
    failures, report = [], {}
    for script in hooks:
        skipped = ran = checked = 0
        batch = subprocess.run([args.hookd, 'decide', str(script), '--jsonl'],
                               input='\n'.join(json.dumps(p) for p in calls) + '\n',
                               text=True, capture_output=True, timeout=600).stdout.split()
        if len(batch) != len(calls):
            raise SystemExit(f'hookd decided {len(batch)} of {len(calls)} calls for {script.name}')
        for payload, verdict in zip(calls, batch):
            if verdict != 'skip':
                ran += 1
                continue
            skipped += 1
            if checked >= args.limit:
                continue
            checked += 1
            result = subprocess.run(['bash', str(script)], input=json.dumps(payload), text=True,
                                    capture_output=True, env=env, timeout=30,
                                    cwd=payload['cwd'] if os.path.isdir(payload['cwd']) else None)
            if result.returncode != 0 or result.stdout.strip() or result.stderr.strip():
                failures.append({'hook': script.name, 'command': payload['tool_input'].get('command', '')[:300],
                                 'exit': result.returncode, 'out': (result.stdout + result.stderr)[:300]})
        report[script.name] = {'calls': len(calls), 'skip': skipped, 'run': ran, 'replayed': checked}
    shutil.rmtree(scratch, ignore_errors=True)
    out = {'days': args.days, 'hooks': report, 'mismatches': failures}
    if args.json:
        print(json.dumps(out, indent=1))
    else:
        print(f'{len(calls)} distinct real Bash calls, last {args.days} days')
        for name, row in report.items():
            print(f'  {name:28} skip {row["skip"]:5}  run {row["run"]:5}  replayed {row["replayed"]:4}')
        print(f'mismatches: {len(failures)}')
        for f in failures[:20]:
            print('  ', f['hook'], f['exit'], f['command'][:120].replace('\n', ' '), '->', f['out'][:120].replace('\n', ' '))
    return 1 if failures else 0


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
    r = sub.add_parser('refusals')
    r.add_argument('--days', type=float, default=7)
    r.add_argument('--samples', type=int, default=5)
    r.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    return parity(args) if args.mode == 'parity' else refusals(args)


if __name__ == '__main__':
    raise SystemExit(main())
