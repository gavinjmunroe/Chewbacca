#!/usr/bin/env python3
"""Measure what the configured Claude Code hooks cost for one tool call.

Runs every hook that would fire for an event and tool, the way the host does
(command through bash, payload on stdin), and reports wall and CPU per hook,
children included. Nothing is cached between runs, so a number here is what a
real tool call pays. Read-only: payloads use a throwaway session id and a
scratch CHEWBACCA_HOME, so no hook writes into the real write-log or tab board.

    hook_bench.py                       # PreToolUse+PostToolUse for Bash `ls`
    hook_bench.py --event Stop --runs 3
    hook_bench.py --json
"""
import argparse
import json
import os
from pathlib import Path
import re
import resource
import subprocess
import sys
import tempfile
import time

SETTINGS = Path.home() / '.claude/settings.json'


def matching(settings, event, tool):
    """Hook commands the host would run for this event and tool name."""
    found = []
    for group in settings.get('hooks', {}).get(event, []):
        matcher = group.get('matcher') or ''
        if matcher and not re.fullmatch(matcher, tool or ''):
            continue
        for hook in group.get('hooks', []):
            if hook.get('type', 'command') == 'command' and hook.get('command'):
                found.append(hook['command'])
    return found


def run_one(command, payload, env, timeout=30):
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    started = time.perf_counter()
    try:
        result = subprocess.run(['bash', '-c', command], input=json.dumps(payload),
                                text=True, capture_output=True, env=env, timeout=timeout,
                                cwd=payload.get('cwd') or None)
        code = result.returncode
    except subprocess.TimeoutExpired:
        code = 'timeout'
    wall = time.perf_counter() - started
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    cpu = (after.ru_utime - before.ru_utime) + (after.ru_stime - before.ru_stime)
    return wall, cpu, code


def name_of(command):
    if '"$H" dispatch ' in command:
        return f'hookd dispatch ({command.split("; exec /bin/bash")[0].count("--guard ")} guards)'
    for part in command.split():
        if part.endswith(('.sh', '.py', '.js')):
            return Path(part).name
    return command[:40]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--event', action='append',
                        help='hook event, repeatable (default PreToolUse and PostToolUse)')
    parser.add_argument('--tool', default='Bash')
    parser.add_argument('--command', default='ls', help='Bash command in the payload')
    parser.add_argument('--cwd', default=str(Path.home() / 'code/chewbacca'))
    parser.add_argument('--runs', type=int, default=2, help='best of N per hook')
    parser.add_argument('--settings', default=str(SETTINGS))
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    settings = json.loads(Path(args.settings).read_text())
    events = args.event or ['PreToolUse', 'PostToolUse']
    scratch = tempfile.mkdtemp(prefix='hook-bench-')
    # The machine's hookd capability marker (setup.sh writes it after probing
    # the binary), so terminal-loop.sh takes the path it takes for real.
    marker = Path.home() / '.chewbacca/hookd-terminal-event'
    if marker.exists():
        Path(scratch, marker.name).touch()
    env = dict(os.environ, CHEWBACCA_HOME=scratch,
               CHEWBACCA_WRITE_LOG=os.path.join(scratch, 'write-log.tsv'),
               CHEWBACCA_SESSION_STATE=os.path.join(scratch, 'session-state'))
    rows = []
    for event in events:
        for index, command in enumerate(matching(settings, event, args.tool)):
            best = None
            for run in range(max(1, args.runs)):
                payload = {'session_id': 'hook-bench', 'hook_event_name': event,
                           'tool_name': args.tool, 'cwd': args.cwd,
                           'tool_use_id': f'bench-{index}-{run}',
                           'transcript_path': os.path.join(scratch, 'none.jsonl'),
                           'tool_input': {'command': args.command} if args.tool == 'Bash' else {}}
                if event == 'PostToolUse':
                    # write-log needs its own Pre to pair with.
                    run_one(command, dict(payload, hook_event_name='PreToolUse'), env)
                measured = run_one(command, payload, env)
                best = measured if best is None or measured[1] < best[1] else best
            rows.append({'event': event, 'hook': name_of(command), 'wall': round(best[0], 3),
                         'cpu': round(best[1], 3), 'exit': best[2]})
    if args.json:
        print(json.dumps(rows, indent=1))
        return 0
    for event in events:
        mine = sorted((r for r in rows if r['event'] == event), key=lambda r: -r['cpu'])
        print(f'{event}: {len(mine)} hooks, cpu {sum(r["cpu"] for r in mine):.2f}s, '
              f'slowest wall {max((r["wall"] for r in mine), default=0):.2f}s')
        for row in mine:
            print(f'  {row["cpu"]:6.3f} cpu  {row["wall"]:6.3f} wall  {row["hook"]}  exit {row["exit"]}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
