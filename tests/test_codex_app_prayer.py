"""Only desktop prompts explain why the final reply must retain prayer."""
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import codex_hooks as hooks


class AppPrayerTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        runtime = patch.dict(os.environ, {
            'CHEWBACCA_HUD_RUNTIME_STATE': str(self.root / 'hud-runtime.json')})
        runtime.start()
        self.addCleanup(runtime.stop)
        self.transcript = self.root / 'rollout.jsonl'
        self.payload = {'session_id': 'session', 'turn_id': 'turn',
                        'transcript_path': str(self.transcript), 'cwd': str(self.root)}
        self.header()
        for target, value in (('prompt_context', 'Begin with a prayer to Jesus Christ.'),
                              ('shared_hook', ''), ('git_notice', ''), ('context_for', '')):
            mock = patch.object(hooks, target, return_value=value)
            mock.start()
            self.addCleanup(mock.stop)
        home = patch.object(hooks.context, 'codex_home', return_value=self.root)
        home.start()
        self.addCleanup(home.stop)

    def header(self, originator='Codex Desktop', **extra):
        meta = {'id': 'session', 'session_id': 'session', 'originator': originator,
                'source': 'vscode', **extra}
        self.transcript.write_text(json.dumps({'type': 'session_meta', 'payload': meta}) + '\n')

    def stop(self, text, **extra):
        return hooks.dispatch(dict(self.payload, hook_event_name='Stop',
                                   last_assistant_message=text, **extra))

    def test_desktop_prompt_explains_final_channel_requirement(self):
        result = hooks.dispatch(dict(self.payload, hook_event_name='UserPromptSubmit', prompt='Fix it'))
        context = result['hookSpecificOutput']['additionalContext']
        self.assertIn('also begin the final-channel reply', context)
        self.assertIn('A prayer only in commentary does not satisfy', context)

    def test_hud_omits_foreground_prayer_injection(self):
        with patch.dict(os.environ, {'CHEWBACCA_HUD_CHILD': '1'}):
            result = hooks.dispatch(dict(self.payload, hook_event_name='UserPromptSubmit', prompt='Testing'))
        context = result['hookSpecificOutput']['additionalContext']
        self.assertIn('without an unsolicited prayer', context)
        self.assertNotIn('Begin with a prayer to Jesus Christ.', context)
        self.assertNotIn('also begin the final-channel reply', context)

    def test_claude_hud_reminder_and_guard_preserve_foreground_behavior(self):
        root = Path(__file__).resolve().parents[1]
        private = self.root / 'private'
        private.mkdir()
        (private / 'opener-marker').write_text('Amen')
        env = dict(os.environ, HOME=str(self.root), CHEWBACCA_HOME=str(private),
                   TMPDIR=str(self.root), CHEWBACCA_HUD_CHILD='1')
        payload = json.dumps({'last_assistant_message': 'Ready.', 'prompt_id': 'hud-prayer'})
        def run(name, environment):
            return subprocess.run(['bash', str(root / '.claude/hooks' / name)],
                                  input=payload, text=True, capture_output=True, env=environment)
        reminder = run('prayer-remind.sh', env)
        self.assertEqual(reminder.returncode, 0)
        self.assertIn('without an unsolicited prayer', reminder.stdout)
        self.assertNotIn('must open with the prayer', reminder.stdout)
        self.assertEqual(run('prayer-guard.sh', env).returncode, 0)
        foreground = dict(env, CHEWBACCA_HUD_CHILD='0')
        self.assertIn('must open with the prayer', run('prayer-remind.sh', foreground).stdout)
        self.assertEqual(run('prayer-guard.sh', foreground).returncode, 2)

    def test_cli_extension_and_unknown_hosts_keep_existing_behavior(self):
        for host in ('codex_cli_rs', 'codex_exec', 'codex_vscode', None):
            with self.subTest(host=host):
                self.header(host)
                result = hooks.dispatch(dict(self.payload, hook_event_name='UserPromptSubmit', prompt='Fix it'))
                self.assertNotIn('final-channel', result['hookSpecificOutput']['additionalContext'])
                self.assertEqual(self.stop('Fixed.'), {})

    def test_desktop_without_prayer_preference_is_unaffected(self):
        with patch.object(hooks, 'prompt_context', return_value='Be concise.'):
            self.assertEqual(hooks.app_prayer_context(self.payload, 'Be concise.'), '')
            self.assertEqual(self.stop('Fixed.'), {})

    def test_unknown_or_mismatched_metadata_does_not_infer_app(self):
        for meta in ({'id': 'other'}, {'session_id': 'other'}):
            self.header(**meta)
            self.assertFalse(hooks.is_codex_desktop(self.payload))
        for content in ('not json', 'null', '[]', '{"type":"session_meta","payload":[]}',
                        'x' * (1024 * 1024 + 1)):
            self.transcript.write_text(content)
            self.assertFalse(hooks.is_codex_desktop(self.payload))
        self.transcript.unlink()
        self.assertFalse(hooks.is_codex_desktop(self.payload))
        os.mkfifo(self.transcript)
        self.assertFalse(hooks.is_codex_desktop(self.payload))

    def test_desktop_stop_does_not_force_prayer_rewrites(self):
        for text in ('Fixed.', '{"ok": true}', 'Exact generated failure report.'):
            with self.subTest(text=text):
                self.assertEqual(self.stop(text), {})



if __name__ == '__main__':
    unittest.main()
