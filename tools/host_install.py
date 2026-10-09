#!/usr/bin/env python3
"""Register the shared hook bridge in hosts that are not Claude Code or Codex.

Each install only adds the bridge's own entries and leaves every other hook in
place: on 2026-10-08 both ~/.cursor/hooks.json and ~/.gemini/settings.json
already carried a desktop pet's hooks on every event, and a rewrite would have
silently disconnected it. Re-running replaces only the bridge's own entries.
"""
import json
import os
from pathlib import Path
import shlex
import sys

import agent_context as context

ROOT = Path(__file__).resolve().parents[1]
MARK = 'host_hooks.py'
LAUNCHER = 'host-hook'
# The bridge runs up to fifteen Claude Stop hooks, design-gate alone allowed
# 120s, so the host must wait longer than the slowest one or it kills the
# bridge and every refusal from that run is lost. Cursor counts seconds.
BRIDGE_TIMEOUT = 180

# preToolUse already covers Shell, so beforeShellExecution is not registered:
# both would run every shell guard twice per command.
CURSOR_EVENTS = ('sessionStart', 'beforeSubmitPrompt', 'preToolUse', 'afterFileEdit',
                 'afterAgentResponse', 'stop')
GEMINI_EVENTS = ('SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterTool', 'AfterAgent')


def launcher():
    """A fixed path the hosts call, rewritten on every connect.

    Registering the checkout path directly broke every tool call when the
    checkout moved: a missing script makes Python exit 2, which both Cursor and
    Gemini read as a refusal. The launcher fails open instead, and a connect
    from the new location points it at the new checkout.
    """
    path = Path(os.environ.get('CHEWBACCA_HOME', str(Path.home() / '.chewbacca'))).expanduser() / 'bin' / LAUNCHER
    path.parent.mkdir(parents=True, exist_ok=True)
    script = f"""#!/bin/sh
# chewbacca host-hook launcher, rewritten by `chewbacca connect`
ROOT={shlex.quote(str(ROOT))}
PY={shlex.quote(sys.executable)}
[ -x "$PY" ] || PY=$(command -v python3 || echo /usr/bin/python3)
if [ "$1" = connect ]; then
  [ -f "$ROOT/tools/agent_runtime.py" ] && exec "$PY" "$ROOT/tools/agent_runtime.py" connect --new-only --quiet
  exit 0
fi
if [ -f "$ROOT/tools/host_hooks.py" ]; then
  exec "$PY" "$ROOT/tools/host_hooks.py" run --host "$1"
fi
cat >/dev/null
if [ "$1" = cursor ]; then echo '{{"permission": "allow"}}'; else echo '{{}}'; fi
"""
    context.atomic_write(path, script)
    path.chmod(0o755)
    return path


def bridge(host):
    return shlex.join([str(launcher()), host])


def _ours(command):
    return MARK in command or LAUNCHER in command


def _load(path):
    if path.is_file() and path.read_text().strip():
        return json.loads(path.read_text())
    return {}


def cursor(home=None):
    path = (home or Path.home()) / '.cursor/hooks.json'
    data = _load(path)
    data.setdefault('version', 1)
    hooks = data.setdefault('hooks', {})
    command = bridge('cursor')
    for event in CURSOR_EVENTS:
        # Drop our older entries (an old checkout path included) and add one
        # current entry, so a rerun repairs instead of skipping.
        entries = [e for e in hooks.get(event, []) if not _ours(e.get('command', ''))]
        hooks[event] = entries
        entry = {'command': command, 'timeout': BRIDGE_TIMEOUT}
        if event == 'stop':
            # Each refusal re-prompts the agent. Two retries bounds a guard
            # that can never be satisfied; Cursor's own default is five.
            entry['loop_limit'] = 2
        entries.append(entry)
    path.parent.mkdir(parents=True, exist_ok=True)
    context.atomic_write(path, json.dumps(data, indent=2) + '\n')
    return path


def gemini(home=None):
    path = (home or Path.home()) / '.gemini/settings.json'
    data = _load(path)
    hooks = data.setdefault('hooks', {})
    command = bridge('gemini')
    for event in GEMINI_EVENTS:
        groups = [g for g in hooks.get(event, [])
                  if not any(_ours(h.get('command', '')) for h in g.get('hooks', []))]
        hooks[event] = groups
        groups.append({'matcher': '*', 'hooks': [{'name': 'chewbacca', 'type': 'command',
                                                   'command': command, 'timeout': BRIDGE_TIMEOUT * 1000}]})
    path.parent.mkdir(parents=True, exist_ok=True)
    context.atomic_write(path, json.dumps(data, indent=2) + '\n')
    return path


def registered(host, home=None):
    home = home or Path.home()
    path = home / ('.cursor/hooks.json' if host == 'cursor' else '.gemini/settings.json')
    return path.is_file() and (MARK in path.read_text() or LAUNCHER in path.read_text())
