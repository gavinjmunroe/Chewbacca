#!/usr/bin/env python3
"""Run the user's own Claude Code hooks inside other hosts.

Claude Code's ~/.claude/settings.json is the one place hooks are registered.
Cursor and Gemini CLI each call this bridge with their native event JSON; it
translates the event into the payload Claude would have sent, runs every
Claude hook registered for that event (matchers included), and translates the
verdict back. A guard added to Claude therefore applies everywhere with no
second registration, which is what stops the hosts drifting apart.

    host_hooks.py run --host cursor     # stdin: Cursor hook JSON
    host_hooks.py run --host gemini     # stdin: Gemini CLI hook JSON
"""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import agent_context as context

ROOT = Path(__file__).resolve().parents[1]

# Hooks that only make sense inside Claude Code. skill-gate denies every tool
# until the Skill tool has run, and no other host has a Skill tool, so in
# Cursor it would refuse every shell command forever. The Clawd on Desk and
# `say` entries are Claude-only notifiers; Cursor carries its own Clawd hooks.
CLAUDE_ONLY = ('skill-gate.sh', 'Clawd on Desk', "say '", 'terminal-loop.sh', 'permission-log.sh')

# Native tool names to the Claude names the registered matchers expect.
TOOLS = {
    'cursor': {'Shell': 'Bash', 'Write': 'Write', 'Read': 'Read', 'Grep': 'Grep',
               'Delete': 'Bash', 'Task': 'Task'},
    'gemini': {'run_shell_command': 'Bash', 'write_file': 'Write', 'replace': 'Edit',
               'read_file': 'Read', 'read_many_files': 'Read', 'search_file_content': 'Grep',
               'glob': 'Glob', 'web_fetch': 'WebFetch', 'google_web_search': 'WebSearch'},
}


def state_dir():
    path = Path(os.environ.get('CHEWBACCA_HOME', str(Path.home() / '.chewbacca'))).expanduser() / 'host-hooks'
    path.mkdir(parents=True, exist_ok=True)
    path.chmod(0o700)  # replies can carry brain content and pasted tokens
    return path


def registered(event, settings=None):
    settings = settings or context.claude_home() / 'settings.json'
    if not settings.is_file():
        return []
    groups = json.loads(settings.read_text()).get('hooks', {}).get(event, [])
    out = []
    for group in groups:
        for handler in group.get('hooks', []):
            command = handler.get('command', '')
            if handler.get('type', 'command') != 'command' or not command:
                continue
            if any(marker in command for marker in CLAUDE_ONLY):
                continue
            out.append((group.get('matcher', ''), command, handler.get('timeout', 60)))
    return out


def run_hooks(event, payload, cwd, settings=None):
    """Every registered hook for this Claude event, in parallel like Claude runs them."""
    tool = payload.get('tool_name', '')
    chosen = [(command, timeout) for matcher, command, timeout in registered(event, settings)
              if not matcher or matcher == '*' or not tool or re.fullmatch(matcher, tool)]
    env = dict(os.environ, CLAUDE_PROJECT_DIR=cwd,
               PATH=str(ROOT / 'bin') + os.pathsep + os.environ.get('PATH', ''))

    def one(item):
        command, timeout = item
        try:
            done = subprocess.run(['bash', '-c', command], input=json.dumps(payload), text=True,
                                  capture_output=True, cwd=cwd, env=env, timeout=timeout)
        except subprocess.TimeoutExpired:
            return 0, '', ''
        return done.returncode, done.stdout.strip(), done.stderr.strip()

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(one, chosen))
    blocked, context_parts = [], []
    for code, stdout, stderr in results:
        data = {}
        if stdout.startswith('{'):
            try:
                data = json.loads(stdout)
            except ValueError:
                data = {}
        specific = data.get('hookSpecificOutput', {}) if isinstance(data, dict) else {}
        reason = (specific.get('permissionDecisionReason') or data.get('reason')
                  or stderr or stdout) if data or code == 2 else ''
        if code == 2 or data.get('decision') == 'block' or specific.get('permissionDecision') == 'deny':
            blocked.append(reason or 'A required check refused this.')
        elif specific.get('additionalContext'):
            context_parts.append(specific['additionalContext'])
        elif code == 0 and stdout and not data and event in ('UserPromptSubmit', 'SessionStart'):
            # Claude adds plain stdout from these two events to the context.
            context_parts.append(stdout)
    return blocked, context_parts


def briefing(cwd):
    """What a Claude session already has before the first prompt."""
    done = subprocess.run([sys.executable, str(ROOT / 'tools/agent_context.py'), 'read',
                           '--with-instructions'], capture_output=True, text=True, cwd=cwd)
    return done.stdout


def _reply_path(key):
    return state_dir() / (re.sub(r'[^A-Za-z0-9_.-]', '_', key or 'default') + '.reply')


def remember(key, text):
    path = _reply_path(key)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write(text)


def recall(key):
    """Read once: the stop check is the only reader, so nothing piles up."""
    path = _reply_path(key)
    if not path.is_file():
        return ''
    text = path.read_text()
    path.unlink()
    return text


def claude_payload(event, native, cwd, **extra):
    return dict({'hook_event_name': event, 'cwd': cwd,
                 'session_id': native.get('session_id') or native.get('conversation_id') or '',
                 # Claude transcripts are JSONL in one schema; hooks that read
                 # them fail open on an empty path rather than misparse another.
                 'transcript_path': ''}, **extra)


def cursor(native):
    event = native.get('hook_event_name', '')
    cwd = native.get('cwd') or (native.get('workspace_roots') or [os.getcwd()])[0]
    key = native.get('conversation_id', '')
    if event == 'sessionStart':
        _, parts = run_hooks('SessionStart', claude_payload('SessionStart', native, cwd, source='startup'), cwd)
        return {'additional_context': '\n\n'.join([briefing(cwd)] + parts)}
    if event == 'beforeSubmitPrompt':
        blocked, _ = run_hooks('UserPromptSubmit', claude_payload(
            'UserPromptSubmit', native, cwd, prompt=native.get('prompt', '')), cwd)
        if blocked:
            return {'continue': False, 'user_message': blocked[0]}
        return {'continue': True}
    if event in ('preToolUse', 'beforeShellExecution'):
        name = 'Bash' if event == 'beforeShellExecution' else TOOLS['cursor'].get(native.get('tool_name', ''), native.get('tool_name', ''))
        tool_input = dict(native.get('tool_input') or {})
        if event == 'beforeShellExecution':
            tool_input = {'command': native.get('command', '')}
        if name.startswith('MCP:'):
            name = 'mcp__' + name[4:]
        blocked, parts = run_hooks('PreToolUse', claude_payload(
            'PreToolUse', native, cwd, tool_name=name, tool_input=tool_input), cwd)
        if blocked:
            return {'permission': 'deny', 'user_message': blocked[0], 'agent_message': '\n'.join(blocked)}
        reply = {'permission': 'allow'}
        if parts:
            reply['agent_message'] = '\n\n'.join(parts)
        return reply
    if event == 'afterFileEdit':
        edits = native.get('edits') or [{}]
        run_hooks('PostToolUse', claude_payload('PostToolUse', native, cwd, tool_name='Edit', tool_input={
            'file_path': native.get('file_path', ''), 'old_string': edits[0].get('old_string', ''),
            'new_string': edits[0].get('new_string', '')}), cwd)
        return {}
    if event == 'afterAgentResponse':
        remember(key, native.get('text', ''))
        return {}
    if event == 'stop':
        if native.get('status') != 'completed':
            return {}
        blocked, _ = run_hooks('Stop', claude_payload(
            'Stop', native, cwd, last_assistant_message=recall(key),
            stop_hook_active=bool(native.get('loop_count'))), cwd)
        if blocked:
            return {'followup_message': 'A required check refused the last reply. Fix it and answer again:\n'
                    + '\n'.join(blocked)}
        return {}
    return {}


def gemini(native):
    event = native.get('hook_event_name', '')
    cwd = native.get('cwd') or os.getcwd()
    if event == 'SessionStart':
        _, parts = run_hooks('SessionStart', claude_payload('SessionStart', native, cwd,
                             source=native.get('source', 'startup')), cwd)
        return {'hookSpecificOutput': {'hookEventName': 'SessionStart',
                'additionalContext': '\n\n'.join([briefing(cwd)] + parts)}}
    if event == 'BeforeAgent':
        blocked, parts = run_hooks('UserPromptSubmit', claude_payload(
            'UserPromptSubmit', native, cwd, prompt=native.get('prompt', '')), cwd)
        if blocked:
            return {'decision': 'deny', 'reason': blocked[0]}
        return {'hookSpecificOutput': {'hookEventName': 'BeforeAgent', 'additionalContext': '\n\n'.join(parts)}} if parts else {}
    if event in ('BeforeTool', 'AfterTool'):
        name = TOOLS['gemini'].get(native.get('tool_name', ''), native.get('tool_name', ''))
        claude_event = 'PreToolUse' if event == 'BeforeTool' else 'PostToolUse'
        blocked, parts = run_hooks(claude_event, claude_payload(
            claude_event, native, cwd, tool_name=name, tool_input=native.get('tool_input') or {},
            tool_response=native.get('tool_response')), cwd)
        if blocked and event == 'BeforeTool':
            return {'decision': 'deny', 'reason': '\n'.join(blocked)}
        return {'hookSpecificOutput': {'hookEventName': event, 'additionalContext': '\n\n'.join(parts)}} if parts else {}
    if event == 'AfterAgent':
        blocked, _ = run_hooks('Stop', claude_payload(
            'Stop', native, cwd, last_assistant_message=native.get('prompt_response', ''),
            stop_hook_active=bool(native.get('stop_hook_active'))), cwd)
        if blocked and not native.get('stop_hook_active'):
            return {'decision': 'deny', 'reason': 'A required check refused the last reply. Fix it and answer again:\n'
                    + '\n'.join(blocked)}
        return {}
    return {}


HOSTS = {'cursor': cursor, 'gemini': gemini}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('run',))
    parser.add_argument('--host', choices=sorted(HOSTS), required=True)
    args = parser.parse_args()
    raw = sys.stdin.read()
    try:
        native = json.loads(raw) if raw.strip() else {}
        reply = HOSTS[args.host](native)
    except Exception as error:  # noqa: BLE001: a crashed bridge must never block the host
        print(f'chewbacca host bridge: {error}', file=sys.stderr)
        reply = {'permission': 'allow'} if args.host == 'cursor' else {}
    # Cursor blocks a permission event on invalid JSON, so always print an object.
    print(json.dumps(reply))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
