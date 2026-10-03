"""Runtime handoff regressions, without starting a model or a display."""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import hud_runtime

loader = importlib.machinery.SourceFileLoader('hud_listen_runtime_test', str(ROOT / 'bin/hud-listen'))
spec = importlib.util.spec_from_loader(loader.name, loader)
listener_module = importlib.util.module_from_spec(spec)
sys.modules[loader.name] = listener_module
loader.exec_module(listener_module)


class RuntimeTests(unittest.TestCase):
    def test_hud_storage_failure_does_not_abort_foreground_hooks(self):
        import codex_hooks
        with patch.object(hud_runtime, 'claim', side_effect=PermissionError('read-only state')), \
             patch.object(codex_hooks, 'turn_state', return_value={}), \
             patch.object(codex_hooks, 'context_for', return_value='task context'), \
             patch.object(codex_hooks, 'prompt_context', return_value='prompt preference'), \
             patch.object(codex_hooks, 'app_prayer_context', return_value=''), \
             patch.object(codex_hooks, 'shared_hook', return_value='guard context') as guard, \
             patch.object(codex_hooks.context, 'brain_root', return_value=Path(self.temp.name)), \
             patch.object(codex_hooks.context, 'read_sources'):
            for event in ('SessionStart', 'UserPromptSubmit'):
                result = codex_hooks.dispatch_event_body({'hook_event_name': event, 'cwd': self.temp.name})
                text = json.dumps(result)
                self.assertIn('HUD runtime selection could not be saved', text)
                self.assertIn('task context', text)
            self.assertEqual(guard.call_count, 4)

    def test_daemon_marks_all_descendants_including_router_models(self):
        seen = []
        def listener(*args, **kwargs):
            seen.append(os.environ.get('CHEWBACCA_HUD_CHILD'))
            return Mock(run=lambda: 0)
        with patch.dict(os.environ, {'CHEWBACCA_HUD_CHILD': '0', 'HUD_NAMES': 'off'}), \
             patch.object(sys, 'argv', ['hud-listen', '--model-cmd', 'fake-model']), \
             patch.object(listener_module, 'QUICK', False), \
             patch.object(listener_module, 'claim_socket', return_value=(1, '')), \
             patch.object(listener_module, 'Listener', side_effect=listener):
            self.assertEqual(listener_module.main(), 0)
        self.assertEqual(seen, ['1'])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'runtime.json'
        self.env = patch.dict(os.environ, {'CHEWBACCA_HUD_RUNTIME_STATE': str(self.path),
                                           'CHEWBACCA_HUD_CHILD': '0'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_last_foreground_claim_wins_both_directions(self):
        self.assertEqual(hud_runtime.current(), 'claude')
        for runtime in ('codex', 'claude', 'codex'):
            hud_runtime.claim(runtime)
            self.assertEqual(hud_runtime.current(), runtime)

    def test_background_models_cannot_steal_selection(self):
        hud_runtime.claim('codex')
        before = self.path.read_bytes()
        with patch.dict(os.environ, {'CHEWBACCA_HUD_CHILD': '1'}):
            hud_runtime.claim('claude')
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(listener_module.account_env(Path.home() / '.claude')['CHEWBACCA_HUD_CHILD'], '1')

    def test_concurrent_claims_leave_complete_record(self):
        children = [subprocess.Popen([sys.executable, str(ROOT / 'tools/hud_runtime.py'),
                                      runtime], env=dict(os.environ))
                    for runtime in ('claude', 'codex') * 6]
        self.assertTrue(all(child.wait() == 0 for child in children))
        self.assertIn(json.loads(self.path.read_text())['runtime'], ('claude', 'codex'))

    def test_existing_listener_switches_and_retires_previous_model(self):
        listener = listener_module.Listener.__new__(listener_module.Listener)
        listener.auto_runtime = True
        listener.lean = True
        listener.model_cmd = 'claude -p --strict-mcp-config'
        listener.model = Mock()
        listener.model.poll.return_value = None
        previous = listener.model
        listener.session = 'old'
        listener.started = True
        listener.flags = []
        listener.log = Mock()
        listener.refresh_prompt = Mock()
        hud_runtime.claim('codex')
        self.assertEqual(Path(listener.command()[0]).name, 'hud-codex')
        previous.kill.assert_called_once()
        self.assertFalse(listener.started)
        self.assertNotEqual(listener.session, 'old')
        hud_runtime.claim('claude')
        self.assertEqual(listener.command()[0], 'claude')

    def test_explicit_model_command_is_preserved(self):
        listener = listener_module.Listener.__new__(listener_module.Listener)
        listener.auto_runtime = False
        listener.model_cmd = 'custom-model --quiet'
        hud_runtime.claim('codex')
        self.assertEqual(listener.command(), ['custom-model', '--quiet'])

    def command_listener(self):
        listener = listener_module.Listener.__new__(listener_module.Listener)
        listener.auto_runtime = True
        listener.lean = True
        listener.model_cmd = 'claude -p --strict-mcp-config'
        listener.model = None
        listener.session = 'first-session'
        listener.started = False
        listener.flags = []
        listener.log = Mock()
        listener.refresh_prompt = Mock()
        listener.accounts = [Path.home() / '.claude']
        listener.account = 0
        return listener

    def test_automatic_claude_keeps_configured_model(self):
        listener = self.command_listener()
        hud_runtime.claim('claude')
        with patch.object(listener_module, 'user_settings', return_value={'model': 'configured-model'}):
            command = listener.command()
        self.assertEqual(command[command.index('--model') + 1], 'configured-model')
        listener.auto_runtime = False
        listener.model_cmd = 'claude -p --model explicit-model'
        with patch.object(listener_module, 'user_settings', return_value={'model': 'configured-model'}):
            command = listener.command()
        self.assertEqual(command.count('--model'), 1)
        self.assertIn('explicit-model', command)

    def test_runtime_switch_between_selection_and_spawn_waits_for_next_request(self):
        listener = self.command_listener()
        hud_runtime.claim('claude')
        selected = listener.command()
        hud_runtime.claim('codex')
        with patch.object(listener_module.subprocess, 'Popen') as popen:
            listener.model_process(selected)
        launched = popen.call_args.args[0]
        self.assertEqual(launched[:len(selected)], selected)
        self.assertEqual(launched[0], 'claude')
        self.assertIn('--input-format', launched)
        self.assertEqual(Path(listener.command()[0]).name, 'hud-codex')

    def test_account_retry_keeps_runtime_but_uses_new_session(self):
        listener = self.command_listener()
        hud_runtime.claim('claude')
        listener.command()
        hud_runtime.claim('codex')
        listener.session = 'replacement-account-session'
        retry = listener.command(refresh_runtime=False)
        self.assertEqual(retry[0], 'claude')
        self.assertEqual(retry[-2:], ['--session-id', 'replacement-account-session'])
        self.assertEqual(Path(listener.command()[0]).name, 'hud-codex')

    def test_prime_passes_its_selected_runtime_to_spawn(self):
        listener = self.command_listener()
        listener.bare = False
        listener.lean = True
        process = Mock()
        process.poll.return_value = None
        process.stdout = ['{"type":"result","result":"ready"}']
        listener.turn = Mock(return_value=True)
        captured = []

        def spawn(argv):
            hud_runtime.claim('codex')
            captured.append(argv)
            return process

        listener.spawn = spawn
        hud_runtime.claim('claude')
        with patch.object(listener_module, 'later'):
            listener.prime()
        self.assertEqual(captured[0][0], 'claude')
        self.assertEqual(hud_runtime.current(), 'codex')
        self.assertTrue(listener.started)

    def test_claude_prompt_hook_claims_and_child_does_not(self):
        home = Path(self.temp.name) / 'home'
        binary = home / '.local/bin/hud-runtime'
        binary.parent.mkdir(parents=True)
        binary.symlink_to(ROOT / 'bin/hud-runtime')
        env = dict(os.environ, HOME=str(home))
        hook = ROOT / '.claude/hooks/prayer-remind.sh'
        hud_runtime.claim('codex')
        result = subprocess.run(['bash', str(hook)], env=env, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(hud_runtime.current(), 'claude')
        hud_runtime.claim('codex')
        subprocess.run(['bash', str(hook)], env=dict(env, CHEWBACCA_HUD_CHILD='1'),
                       capture_output=True, check=True)
        self.assertEqual(hud_runtime.current(), 'codex')


if __name__ == '__main__':
    unittest.main()
