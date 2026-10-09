"""Cursor and Gemini must run the same Claude hooks, refuse the same things, and
keep every hook another app already registered."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import agent_context as context
import agent_runtime as runtime
import host_install

GUARD = '''#!/bin/bash
# Refuses a reply with no prayer and a shell command containing FORBIDDEN,
# the two shapes of refusal every host has to carry.
payload=$(cat)
event=$(printf '%s' "$payload" | python3 -c 'import json,sys;print(json.load(sys.stdin)["hook_event_name"])')
if [ "$event" = Stop ]; then
  printf '%s' "$payload" | grep -q 'Amen' || { echo 'reply needs the opener' >&2; exit 2; }
fi
if [ "$event" = PreToolUse ]; then
  printf '%s' "$payload" | grep -q FORBIDDEN && { echo 'forbidden command' >&2; exit 2; }
fi
if [ "$event" = UserPromptSubmit ]; then echo 'routing context from claude'; fi
exit 0
'''


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        claude = self.home / '.claude'
        (claude / 'rules').mkdir(parents=True)
        guard = claude / 'guard.sh'
        guard.write_text(GUARD)
        guard.chmod(0o755)
        gate = claude / 'skill-gate.sh'
        gate.write_text('#!/bin/bash\nexit 2\n')
        gate.chmod(0o755)
        settings = {'hooks': {event: [{'hooks': [{'type': 'command', 'command': str(guard)}]},
                                      {'hooks': [{'type': 'command', 'command': str(gate)}]}]
                              for event in ('Stop', 'PreToolUse', 'UserPromptSubmit')}}
        settings['hooks']['PostToolUse'] = [{'matcher': 'Write|Edit', 'hooks': [{'type': 'command', 'command': str(guard)}]}]
        (claude / 'settings.json').write_text(json.dumps(settings))
        (claude / 'CLAUDE.md').write_text('# Mine\n\nAlways test.\n\n@~/.claude/rules/git.md\n')
        (claude / 'rules/git.md').write_text('Commit by path.\n')
        (claude / 'rules/scoped.md').write_text('---\npaths: ["*.tsx"]\n---\nOnly for UI.\n')
        (claude / 'rules/always.md').write_text('Always-on rule.\n')
        self.env = patch.dict(os.environ, {'HOME': str(self.home), 'CLAUDE_CONFIG_DIR': str(claude),
                                           'CODEX_HOME': str(self.home / '.codex'),
                                           'CHEWBACCA_HOME': str(self.home / '.chewbacca')})
        self.env.start()
        self.addCleanup(self.env.stop)

    def bridge(self, host, payload):
        done = subprocess.run([sys.executable, str(ROOT / 'tools/host_hooks.py'), 'run', '--host', host],
                              input=json.dumps(payload), capture_output=True, text=True,
                              env=dict(os.environ), timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout)

    def test_cursor_reply_without_opener_is_sent_back(self):
        cwd = str(self.home)
        self.bridge('cursor', {'hook_event_name': 'afterAgentResponse', 'conversation_id': 'c',
                               'workspace_roots': [cwd], 'text': 'Done.'})
        reply = self.bridge('cursor', {'hook_event_name': 'stop', 'conversation_id': 'c',
                                       'status': 'completed', 'loop_count': 0, 'workspace_roots': [cwd]})
        self.assertIn('reply needs the opener', reply['followup_message'])
        self.bridge('cursor', {'hook_event_name': 'afterAgentResponse', 'conversation_id': 'c',
                               'workspace_roots': [cwd], 'text': 'Thanks. Amen.\n\nDone.'})
        self.assertEqual(self.bridge('cursor', {'hook_event_name': 'stop', 'conversation_id': 'c',
                                                'status': 'completed', 'loop_count': 0,
                                                'workspace_roots': [cwd]}), {})

    def test_cursor_shell_refusal_and_allow(self):
        cwd = str(self.home)
        denied = self.bridge('cursor', {'hook_event_name': 'preToolUse', 'tool_name': 'Shell',
                                        'tool_input': {'command': 'echo FORBIDDEN'}, 'cwd': cwd})
        self.assertEqual(denied['permission'], 'deny')
        # skill-gate refuses everything; outside Claude it must never run.
        allowed = self.bridge('cursor', {'hook_event_name': 'preToolUse', 'tool_name': 'Shell',
                                         'tool_input': {'command': 'ls'}, 'cwd': cwd})
        self.assertEqual(allowed['permission'], 'allow')

    def test_cursor_delete_reaches_shell_guards(self):
        denied = self.bridge('cursor', {'hook_event_name': 'preToolUse', 'tool_name': 'Delete',
                                        'tool_input': {'path': 'FORBIDDEN.txt'}, 'cwd': str(self.home)})
        self.assertEqual(denied['permission'], 'deny')

    def test_gemini_refusals_and_prompt_context(self):
        cwd = str(self.home)
        tool = self.bridge('gemini', {'hook_event_name': 'BeforeTool', 'tool_name': 'run_shell_command',
                                      'tool_input': {'command': 'FORBIDDEN'}, 'cwd': cwd})
        self.assertEqual(tool['decision'], 'deny')
        reply = self.bridge('gemini', {'hook_event_name': 'AfterAgent', 'prompt_response': 'Done.',
                                       'stop_hook_active': False, 'cwd': cwd})
        self.assertEqual(reply['decision'], 'deny')
        retried = self.bridge('gemini', {'hook_event_name': 'AfterAgent', 'prompt_response': 'Done.',
                                         'stop_hook_active': True, 'cwd': cwd})
        self.assertEqual(retried, {}, 'a second refusal must not loop forever')
        prompt = self.bridge('gemini', {'hook_event_name': 'BeforeAgent', 'prompt': 'hi', 'cwd': cwd})
        self.assertIn('routing context from claude', prompt['hookSpecificOutput']['additionalContext'])

    def test_malformed_event_never_blocks_cursor(self):
        done = subprocess.run([sys.executable, str(ROOT / 'tools/host_hooks.py'), 'run', '--host', 'cursor'],
                              input='not json', capture_output=True, text=True, env=dict(os.environ))
        self.assertEqual(json.loads(done.stdout), {'permission': 'allow'})

    def test_installers_keep_other_hooks_and_are_idempotent(self):
        cursor_file = self.home / '.cursor/hooks.json'
        cursor_file.parent.mkdir()
        cursor_file.write_text(json.dumps({'version': 1, 'hooks': {'stop': [{'command': 'pet-app stop'}]}}))
        gemini_file = self.home / '.gemini/settings.json'
        gemini_file.parent.mkdir()
        gemini_file.write_text(json.dumps({'theme': 'dark', 'hooks': {'AfterAgent': [
            {'matcher': '*', 'hooks': [{'type': 'command', 'command': 'pet-app after'}]}]}}))
        for _ in range(2):
            host_install.cursor(self.home)
            host_install.gemini(self.home)
        cursor = json.loads(cursor_file.read_text())['hooks']
        self.assertEqual([e['command'] for e in cursor['stop']][0], 'pet-app stop')
        self.assertEqual(len(cursor['stop']), 2)
        self.assertEqual(cursor['stop'][1]['loop_limit'], 2)
        self.assertNotIn('beforeShellExecution', cursor)
        gemini = json.loads(gemini_file.read_text())
        self.assertEqual(gemini['theme'], 'dark')
        self.assertEqual(len(gemini['hooks']['AfterAgent']), 2)
        self.assertTrue(host_install.registered('cursor', self.home))

    def test_stale_bridge_path_is_repaired_and_launcher_fails_open(self):
        cursor_file = self.home / '.cursor/hooks.json'
        cursor_file.parent.mkdir()
        cursor_file.write_text(json.dumps({'version': 1, 'hooks': {'preToolUse': [
            {'command': 'python3 /gone/checkout/tools/host_hooks.py run --host cursor'}]}}))
        host_install.cursor(self.home)
        commands = [e['command'] for e in json.loads(cursor_file.read_text())['hooks']['preToolUse']]
        self.assertEqual(len(commands), 1)
        self.assertNotIn('/gone/', commands[0])
        launcher = Path(commands[0].split()[0])
        text = launcher.read_text().replace(str(ROOT), '/gone/checkout')
        launcher.write_text(text)
        done = subprocess.run([str(launcher), 'cursor'], input='{}', capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, 'a moved checkout must never block every tool')
        self.assertEqual(json.loads(done.stdout), {'permission': 'allow'})

    def test_shim_never_replaces_a_real_binary(self):
        bin_dir = self.home / 'bin'
        bin_dir.mkdir()
        real = bin_dir / 'codex'
        real.write_bytes(b'\xcf\xfa\xed\xfe binary')
        runtime.terminal_shims(bin_dir)
        self.assertEqual(real.read_bytes(), b'\xcf\xfa\xed\xfe binary')

    def test_standing_instructions_match_what_claude_loads(self):
        text = context.standing_instructions()
        self.assertIn('Always test.', text)
        self.assertIn('Commit by path.', text)
        self.assertIn('Always-on rule.', text)
        self.assertNotIn('Only for UI.', text)
        self.assertNotIn('@~/.claude/rules/git.md', text)
        self.assertEqual(text.count('Commit by path.'), 1)

    def test_bundled_binary_is_found_and_shimmed_without_recursion(self):
        app = self.home / 'App.app/codex'
        app.parent.mkdir()
        app.write_text('#!/bin/sh\necho bundled "$@"\n')
        app.chmod(0o755)
        spec = {'binary': 'definitely-not-on-path-xyz', 'app_binaries': [str(self.home / '*.app/codex')]}
        self.assertEqual(runtime.locate_binary(spec), str(app))
        self.assertTrue(runtime.detected({'binary': None, 'detect_paths': [str(app)]}))
        self.assertFalse(runtime.detected({'binary': None, 'detect_paths': [str(self.home / 'nope')]}))


if __name__ == '__main__':
    unittest.main()
