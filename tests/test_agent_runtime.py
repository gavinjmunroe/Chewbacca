"""Fresh runtime installs must work without another agent's home or credentials."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
try:
    import tomllib
except ImportError:  # 3.11+; hooks and CI may run the stock 3.9
    tomllib = None
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import agent_runtime as runtime
import agent_context as context


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.env = patch.dict(os.environ, {'HOME': str(self.home),
            'CODEX_HOME': str(self.home / 'codex custom'),
            'CLAUDE_CONFIG_DIR': str(self.home / '.claude'),
            'CHEWBACCA_HOME': str(self.home / '.chewbacca'),
            'CHEWBACCA_BRAIN_DIR': str(self.home / 'brain'),
            'CHEWBACCA_TEAM': ''})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_first_session_connects_only_hosts_installed_after_setup(self):
        # 10/12 stranger run: setup --runtime claude-code, then the first
        # session's connect --new-only wrote Codex, Cursor and Gemini configs.
        wired = []
        with patch.object(runtime, 'selected', side_effect=lambda name: ['claude-code', 'codex', 'cursor']
                          if name == 'all' else name.split(',')):
            runtime.remember_hosts_at_setup()
            with patch.object(runtime, 'setup', side_effect=lambda names, *a, **k: wired.append(names) or None), \
                    patch.object(runtime, 'terminal_shims', return_value=[]), \
                    patch.object(runtime, 'export_chat', return_value=None):
                first = runtime.connect(new_only=True)
        self.assertEqual(first['connected_now'], [])
        self.assertEqual(wired, [])
        with patch.object(runtime, 'selected', side_effect=lambda name: ['claude-code', 'codex', 'cursor', 'gemini']
                          if name == 'all' else name.split(',')), \
                patch.object(runtime, 'setup', side_effect=lambda names, *a, **k: wired.append(names) or None), \
                patch.object(runtime, 'terminal_shims', return_value=[]), \
                patch.object(runtime, 'export_chat', return_value=None):
            later = runtime.connect(new_only=True)
        self.assertEqual(later['connected_now'], ['gemini'])
        self.assertEqual(wired, ['gemini'])

    @unittest.skipUnless(tomllib, 'tomllib needs Python 3.11+')
    def test_codex_install_needs_no_claude_and_preserves_configuration(self):
        home = context.codex_home()
        home.mkdir()
        config = home / 'config.toml'
        config.write_text('model = "my-model"\nmodel_provider = "local"\n')
        before = config.read_bytes()
        for _ in range(2):
            result = runtime.setup('codex')
            self.assertFalse(result['runtimes'][0]['skills']['conflicts'])
        self.assertFalse((self.home / '.claude').exists())
        self.assertTrue(config.read_bytes().startswith(before))
        parsed = tomllib.loads(config.read_text())
        self.assertEqual(parsed['model'], 'my-model')
        self.assertEqual(parsed['model_provider'], 'local')
        self.assertEqual(parsed['agents'], {'enabled': True, 'max_concurrent_threads_per_session': 100})
        self.assertEqual((home / 'hooks.json').read_text().count('codex_hooks.py'), 5)
        self.assertEqual((home / 'AGENTS.md').read_text().count(runtime.BEGIN), 1)
        self.assertTrue((self.home / '.agents/skills/debugging/SKILL.md').is_file())
        self.assertEqual(context.brain_root(home), (self.home / 'brain').resolve())

    @unittest.skipUnless(tomllib, 'tomllib needs Python 3.11+')
    def test_codex_capacity_fresh_install_and_reversible_existing_config(self):
        config = context.codex_home() / 'config.toml'
        runtime.setup('codex')
        self.assertEqual(tomllib.loads(config.read_text())['agents'],
                         {'enabled': True, 'max_concurrent_threads_per_session': 100})
        runtime.remove('codex')
        self.assertFalse(config.exists())
        original = '# keep comments\r\nmodel = "chosen"\r\napproval_policy = "never"\r\n[agents]\r\n# owned settings\r\nmax_depth = 2\r\n[other]\r\nx = "unchanged"\r\n'
        config.write_bytes(original.encode())
        runtime.setup('codex')
        updated = config.read_bytes()
        runtime.setup('codex')
        self.assertEqual(config.read_bytes(), updated)
        self.assertIn(b'# owned settings\r\n', updated)
        self.assertEqual(tomllib.loads(updated.decode())['agents']['max_depth'], 2)
        runtime.remove('codex')
        self.assertEqual(config.read_bytes(), original.encode())

    @unittest.skipUnless(tomllib, 'tomllib needs Python 3.11+')
    def test_codex_capacity_preserves_explicit_and_legacy_values(self):
        cases = [
            ('[agents]\nenabled = false\nmax_concurrent_threads_per_session = 3\n', {}),
            ('[agents]\nmax_threads = 7\n', {'enabled': True}),
            ('agents.enabled = false\n', {'max_concurrent_threads_per_session': 100}),
            ('["agents"]\nmax_threads = 0\nenabled = false\n', {}),
            ('agents = { enabled = false, max_threads = 9 }\n', {}),
            ('[features]\nmulti_agent = false\n', {'max_concurrent_threads_per_session': 100}),
            ('[features]\ncollab = false\n', {'max_concurrent_threads_per_session': 100}),
            ('features = {multi_agent = false}\n', {'max_concurrent_threads_per_session': 100}),
            ('features = {collab = false}\n', {'max_concurrent_threads_per_session': 100}),
            ('[features]\nmulti_agent = true\n', {'enabled': True, 'max_concurrent_threads_per_session': 100}),
            ('[features]\ncollab = false\n[agents]\nmax_threads = 4\n', {}),
            ('[agents.worker]\ndescription = "custom"\n',
             {'enabled': True, 'max_concurrent_threads_per_session': 100}),
            ('prompt = """\n[agents]\ntext\n"""\n',
             {'enabled': True, 'max_concurrent_threads_per_session': 100}),
        ]
        for original, additions in cases:
            with self.subTest(original=original):
                updated = runtime.codex_capacity_config(original)
                expected = tomllib.loads(original)
                expected.setdefault('agents', {}).update(additions)
                self.assertEqual(tomllib.loads(updated), expected)
                self.assertEqual(runtime.codex_capacity_config(updated), updated)
                if not additions:
                    self.assertEqual(updated, original)

    @unittest.skipUnless(tomllib, 'tomllib needs Python 3.11+')
    def test_codex_unsupported_config_refuses_before_any_install_writes(self):
        for original in ('not valid TOML', 'agents = {enabled = false}\n', 'agents = 3\n'):
            with self.subTest(original=original):
                home = context.codex_home()
                home.mkdir(exist_ok=True)
                config = home / 'config.toml'
                config.write_text(original)
                with self.assertRaisesRegex(ValueError, 'no adapter files changed'):
                    runtime.setup('both')
                self.assertEqual(config.read_text(), original)
                self.assertEqual({p.name for p in home.iterdir()}, {'config.toml'})
                self.assertFalse(runtime.shared_home().exists())
                self.assertFalse((self.home / 'brain').exists())
                self.assertFalse((self.home / '.claude').exists())

    def test_codex_later_user_config_edits_survive_remove(self):
        runtime.setup('codex')
        config = context.codex_home() / 'config.toml'
        config.write_text(config.read_text() + '\n# user edit\n')
        edited = config.read_bytes()
        runtime.setup('codex')
        result = runtime.remove('codex')
        self.assertIn(str(config.resolve()), result[0]['preserved'])
        self.assertEqual(config.read_bytes(), edited)

    def test_capacity_does_not_select_codex_for_claude_only_auto(self):
        # Detection also looks inside app bundles under /Applications, which a
        # PATH stub cannot hide, so the machine is stubbed at that level too.
        with patch.object(runtime.shutil, 'which', side_effect=lambda name: '/bin/claude' if name == 'claude' else None), \
                patch.object(runtime, 'detected', side_effect=lambda spec: spec.get('binary') == 'claude'):
            result = runtime.setup('auto')
        self.assertEqual([item['id'] for item in result['runtimes']], ['claude-code'])
        self.assertFalse(context.codex_home().exists())

    def test_codex_config_changed_during_setup_is_not_overwritten(self):
        home = context.codex_home()
        home.mkdir()
        config = home / 'config.toml'
        config.write_text('model = "original"\n')
        install_skills = runtime.skills.install

        def concurrent_edit(*args, **kwargs):
            config.write_text('model = "new-user-choice"\n')
            return install_skills(*args, **kwargs)

        with patch.object(runtime.skills, 'install', side_effect=concurrent_edit):
            with self.assertRaisesRegex(ValueError, 'concurrent edit preserved'):
                runtime.setup('codex')
        self.assertEqual(config.read_text(), 'model = "new-user-choice"\n')
        self.assertFalse((home / 'hooks.json').exists())

    def test_claude_native_configuration_survives_and_every_handler_runs(self):
        home = self.home / '.claude'
        home.mkdir()
        path = home / 'settings.json'
        original = {'model': 'custom', 'permissions': {'deny': ['personal-rule']},
                    'hooks': {'Stop': [{'hooks': [{'type': 'command', 'command': 'user-hook'}]}]}}
        path.write_text(json.dumps(original))
        runtime.setup('claude-code')
        first = path.read_text()
        runtime.setup('claude-code')
        self.assertEqual(path.read_text(), first)
        data = json.loads(first)
        self.assertEqual(data['permissions'], original['permissions'])
        self.assertEqual(data['model'], 'custom')
        self.assertIn('user-hook', first)
        # Run an actual registered shared handler using Claude's wire format.
        command = next(h['command'] for g in data['hooks']['PreToolUse'] for h in g['hooks']
                       if 'submit-guard.sh' in h['command'])
        import shlex
        payload = {'hook_event_name': 'PreToolUse', 'cwd': str(self.home), 'tool_name': 'Bash',
                   'tool_input': {'command': 'curl -X POST https://school.brightspace.invalid/d2l/lms/dropbox/submit'}}
        blocked = subprocess.run(shlex.split(command), input=json.dumps(payload), text=True, capture_output=True)
        self.assertEqual(blocked.returncode, 2, blocked.stdout + blocked.stderr)
        payload['tool_input']['command'] = 'git status --short'
        allowed = subprocess.run(shlex.split(command), input=json.dumps(payload), text=True, capture_output=True)
        self.assertEqual(allowed.returncode, 0, allowed.stderr)
        self.assertFalse(context.codex_home().exists())

    def test_tool_checks_carry_matchers_and_an_old_matcherless_one_is_repaired(self):
        # 2026-10-05: a matcher-less PreToolUse write-log ran on every Read and
        # Grep and left 24,758 orphan snapshots in ~/.chewbacca/session-state.
        home = self.home / '.claude'
        home.mkdir()
        old = ' '.join([sys.executable, str(ROOT / 'tools/shared_checks.py'), 'run', 'write-log.sh'])
        (home / 'settings.json').write_text(json.dumps(
            {'hooks': {'PreToolUse': [{'hooks': [{'type': 'command', 'command': old}]}]}}))
        runtime.setup('claude-code')
        data = json.loads((home / 'settings.json').read_text())
        for event in ('PreToolUse', 'PostToolUse'):
            for group in data['hooks'][event]:
                if 'shared_checks.py run' in json.dumps(group):
                    self.assertTrue(group.get('matcher'), (event, group))
        pre = [g for g in data['hooks']['PreToolUse'] if 'write-log.sh' in json.dumps(g)]
        self.assertEqual(len(pre), 1)
        self.assertEqual(pre[0]['matcher'], 'Write|Edit|Bash|NotebookEdit')

    def test_plan_and_status_do_not_write_or_call_models(self):
        with patch.object(runtime.shutil, 'which', return_value=None):
            runtime.plan('both')
            runtime.status('both')
        self.assertEqual(list(self.home.iterdir()), [])

    def test_windows_declines_shell_install_before_any_write(self):
        with patch.object(runtime.sys, 'platform', 'win32'), patch.object(runtime.shutil, 'which', return_value=None):
            with self.assertRaisesRegex(ValueError, 'export only'):
                runtime.setup('codex')
        self.assertEqual(list(self.home.iterdir()), [])

    def test_stranger_install_never_loads_team_memory(self):
        # 2026-10-09: a fresh install put Amber's client notes in a stranger's sessions.
        self.assertFalse(runtime.is_teammate())
        target = self.home / 'CLAUDE.md'
        target.write_text('no team line here\n')
        self.assertFalse(runtime.is_teammate(target))

    def test_teammate_keeps_team_memory_by_flag_env_or_existing_install(self):
        with patch.dict(os.environ, {'CHEWBACCA_TEAM': '1'}):
            self.assertTrue(runtime.is_teammate())
        target = self.home / 'CLAUDE.md'
        target.write_text(runtime.instruction_block(runtime.registry()['runtimes']['claude-code'], True))
        self.assertTrue(runtime.is_teammate(target))
        shared = runtime.shared_home()
        shared.mkdir(parents=True, exist_ok=True)
        (shared / 'context.json').write_text('{"brain_dir": "/x", "team": true}')
        self.assertTrue(runtime.is_teammate())

    def test_team_choice_survives_setup_and_can_be_removed(self):
        claude = runtime.claude_home() / 'CLAUDE.md'
        runtime.setup('claude-code', team=True)
        saved = json.loads((runtime.shared_home() / 'context.json').read_text())
        self.assertEqual(saved['brain_dir'], str((self.home / 'brain').resolve()))
        self.assertIs(saved['team'], True)
        compact = '@' + str(runtime.team_index_path())
        self.assertIn(compact, claude.read_text())
        runtime.setup('claude-code')
        self.assertIn(compact, claude.read_text())
        runtime.setup('claude-code', no_team=True)
        self.assertNotIn(runtime.TEAM_LINE, claude.read_text())
        runtime.setup('claude-code')
        self.assertNotIn(runtime.TEAM_LINE, claude.read_text())

    def test_teammate_imports_compact_index_with_every_slug_and_lesson(self):
        # 2026-10-11: the full index was 11,636 tokens of every session.
        path = runtime.write_team_index()
        body = path.read_text()
        source = (ROOT / 'team/memory/MEMORY.md').read_text()
        slugs = [line[2:].split(':', 1)[0] for line in source.splitlines() if line.startswith('- ')]
        for slug in slugs:
            self.assertIn('- ' + slug, body)
        for line in source.splitlines():
            if line.startswith('- feedback_'):
                self.assertIn(line, body)
        self.assertIn('never goes here', body)
        self.assertLess(len(body), len(source))
        spec = runtime.registry()['runtimes']['claude-code']
        self.assertIn('@' + str(path), runtime.instruction_block(spec, True))
        path.unlink()
        self.assertIn('@' + str(ROOT / 'team/memory/MEMORY.md'), runtime.instruction_block(spec, True))

    def test_shared_guidance_is_discoverable_without_hooks_for_each_runtime(self):
        for key in ('claude-code', 'codex'):
            spec = runtime.registry()['runtimes'][key]
            block = runtime.instruction_block(spec)
            self.assertIn(str(ROOT / 'config/instructions/agent-neutral.md'), block)
            self.assertNotIn('team/memory/MEMORY.md', block)
            self.assertIn('@' + str(ROOT / 'team/memory/MEMORY.md'), runtime.instruction_block(spec, True))
        source = (ROOT / 'setup.sh').read_text()
        helper = source.split('install_agent_neutral_rule() {', 1)[1].split('\n}', 1)[0]
        self.assertNotIn('paths:', helper)
        self.assertIn('config/instructions/agent-neutral.md', helper)

    def test_codex_home_explicit_isolation_preserves_configured_paths_otherwise(self):
        with patch.dict(os.environ, {'CODEX_HOME': '/synthetic/account/.codex',
                                     'CHEWBACCA_ISOLATED_HOME': '1'}):
            self.assertEqual(context.codex_home(), self.home / '.codex')
        with patch.dict(os.environ, {'CODEX_HOME': str(self.home / 'explicit-codex'),
                                     'CHEWBACCA_ISOLATED_HOME': '1'}):
            self.assertEqual(context.codex_home(), self.home / 'explicit-codex')
        with patch.dict(os.environ, {'CODEX_HOME': '/synthetic/explicit-shared-codex',
                                     'CHEWBACCA_ISOLATED_HOME': '0'}):
            self.assertEqual(context.codex_home(), Path('/synthetic/explicit-shared-codex'))

    def test_codex_home_without_posix_pwd_module(self):
        with patch.dict(sys.modules, {'pwd': None}):
            with patch.dict(os.environ, {'CODEX_HOME': ''}):
                self.assertEqual(context.codex_home(), self.home / '.codex')
            with patch.dict(os.environ, {'CODEX_HOME': str(self.home / 'custom'),
                                         'CHEWBACCA_ISOLATED_HOME': '0'}):
                self.assertEqual(context.codex_home(), self.home / 'custom')

    def test_export_keeps_private_brain_out_and_preserves_user_content(self):
        output = self.home / 'export'
        output.mkdir()
        target = output / 'AGENTS.md'
        target.write_text('User-owned instruction\n')
        for _ in range(2):
            runtime.export('generic', output)
        text = target.read_text()
        self.assertTrue(text.startswith('User-owned instruction'))
        self.assertNotIn(str(self.home), text)
        self.assertEqual(text.count(runtime.BEGIN), 1)

    def test_all_declared_checks_exist(self):
        for scripts in runtime.CLAUDE_CHECKS.values():
            for name in scripts:
                self.assertTrue((ROOT / '.claude/hooks' / name).is_file(), name)

    def test_remove_restores_only_unchanged_owned_files_and_links(self):
        home = context.codex_home()
        home.mkdir()
        target = home / 'AGENTS.md'
        target.write_text('My original instructions')
        for _ in range(2):
            runtime.setup('codex')
        runtime.remove('codex')
        self.assertEqual(target.read_text(), 'My original instructions')
        self.assertFalse((home / 'hooks.json').exists())
        self.assertFalse((self.home / '.agents/skills/debugging').exists())
        self.assertTrue((runtime.shared_home() / 'skills/debugging').exists())
        runtime.setup('codex')
        target.write_text('My newer instructions')
        result = runtime.remove('codex')
        self.assertIn(str(target.resolve()), result[0]['preserved'])
        self.assertEqual(target.read_text(), 'My newer instructions')

    def test_formatter_skips_broken_path_node_and_executes_working_runtime(self):
        import shared_checks
        broken = self.home / 'bin'
        working = self.home / '.nvm/versions/node/v22/bin'
        broken.mkdir()
        working.mkdir(parents=True)
        (broken / 'node').write_text('#!/bin/sh\nexit 127\n')
        (working / 'node').write_text('#!/bin/sh\n[ "$1" = --version ] && exit 0\nprintf formatted > "$3"\n')
        (broken / 'prettier').write_text('#!/usr/bin/env node\n')
        for path in (broken / 'node', working / 'node', broken / 'prettier'):
            path.chmod(0o755)
        target = self.home / 'sample.json'
        target.write_text('{}')
        with patch.dict(os.environ, PATH=str(broken) + ':/usr/bin:/bin'):
            shared_checks.format_file(str(target), str(self.home))
        self.assertEqual(target.read_text(), 'formatted')

    def test_setup_cli_preview_does_not_bootstrap_claude(self):
        result = subprocess.run(['bash', str(ROOT / 'setup.sh'), '--runtime', 'codex', '--dry-run', '--json'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['runtimes'][0]['id'], 'codex')
        # Apple's /usr/bin/python3 (3.9) puts its own bytecode cache under
        # ~/Library/Caches/com.apple.python whenever it imports anything; that
        # is the interpreter's write, not setup's (seen 10/13 in a temp HOME).
        made = [p for p in self.home.rglob('*')
                if p.relative_to(self.home).parts[:3] != ('Library', 'Caches', 'com.apple.python')
                and p.relative_to(self.home).parts not in (('Library',), ('Library', 'Caches'))]
        self.assertEqual(made, [])


    def test_vscode_gets_instructions_skills_and_mcp_and_undoes_cleanly(self):
        # 10/13: `--every-agent` promised VS Code and there was no adapter.
        user = runtime.vscode_user_dir()
        user.mkdir(parents=True)
        mcp = user / 'mcp.json'
        original = b'{\n  "servers": {"mine": {"type": "stdio", "command": "mine"}}\n}\n'
        mcp.write_bytes(original)
        self.assertIn('vscode', runtime.selected('all'))
        for _ in range(2):
            result = runtime.setup('vscode')
        instructions = runtime.vscode_instructions().read_text()
        self.assertTrue(instructions.startswith('---\n'))
        self.assertIn('applyTo: "**"', instructions)
        self.assertIn('agent_context.py', instructions)
        self.assertEqual(instructions.count(runtime.BEGIN), 1)
        servers = json.loads(mcp.read_text())['servers']
        self.assertEqual(servers['mine'], {'type': 'stdio', 'command': 'mine'})
        import host_mcp
        if host_mcp.chewbacca_server():
            self.assertEqual(servers['chewbacca']['type'], 'stdio')
        self.assertTrue((self.home / '.agents/skills/debugging/SKILL.md').is_file())
        backup = mcp.with_name('mcp.json' + runtime.BACKUP_SUFFIX)
        self.assertEqual(backup.read_bytes(), original)
        self.assertEqual(result['runtimes'][0]['backups'], [])  # the rerun kept the first backup
        runtime.remove('vscode')
        self.assertEqual(mcp.read_bytes(), original)
        self.assertFalse(runtime.vscode_instructions().exists())

    def test_vscode_instructions_symlink_survives_setup_and_undo(self):
        dotfiles = self.home / 'dotfiles/chewbacca.instructions.md'
        dotfiles.parent.mkdir()
        dotfiles.write_text('mine\n')
        link = runtime.vscode_instructions()
        link.parent.mkdir(parents=True)
        link.symlink_to(dotfiles)
        runtime.vscode_user_dir().mkdir(parents=True)
        runtime.setup('vscode')
        self.assertTrue(link.is_symlink())
        self.assertIn('applyTo', dotfiles.read_text())
        runtime.remove('vscode')
        self.assertTrue(link.is_symlink())
        self.assertEqual(dotfiles.read_text(), 'mine\n')

    def test_vscode_mcp_symlink_survives_setup_and_undo(self):
        import host_mcp
        if not host_mcp.chewbacca_server():
            self.skipTest('no node, so nothing is written to mcp.json')
        dotfiles = self.home / 'dotfiles/mcp.json'
        dotfiles.parent.mkdir()
        dotfiles.write_text('{"servers": {}}\n')
        user = runtime.vscode_user_dir()
        user.mkdir(parents=True)
        (user / 'mcp.json').symlink_to(dotfiles)
        runtime.setup('vscode')
        self.assertTrue((user / 'mcp.json').is_symlink())
        self.assertIn('chewbacca', dotfiles.read_text())
        runtime.remove('vscode')
        self.assertTrue((user / 'mcp.json').is_symlink())
        self.assertEqual(dotfiles.read_text(), '{"servers": {}}\n')

    def test_vscode_mcp_with_comments_is_left_alone_and_setup_finishes(self):
        user = runtime.vscode_user_dir()
        user.mkdir(parents=True)
        jsonc = '{\n  // mine\n  "servers": {"mine": {"type": "stdio", "command": "x"},},\n}\n'
        (user / 'mcp.json').write_text(jsonc)
        result = runtime.setup('vscode')
        self.assertEqual(result['runtimes'][0]['mcp_added'], [])
        self.assertEqual((user / 'mcp.json').read_text(), jsonc)
        self.assertTrue((runtime.shared_home() / 'runtime-installs/vscode.json').is_file())

    def test_mcp_entry_prefers_the_stable_link_over_a_snapshot_path(self):
        import host_mcp
        if not host_mcp.chewbacca_server():
            self.skipTest('no node')
        link = self.home / '.local/bin/chewbacca-mcp'
        link.parent.mkdir(parents=True)
        link.symlink_to(ROOT / 'bin/chewbacca-mcp')
        self.assertEqual(host_mcp.chewbacca_server()['args'], [str(link)])

    def test_export_works_for_hosts_without_an_instruction_file(self):
        for name in ('vscode', 'cursor', 'gemini'):
            out = Path(runtime.export(name, self.home / ('export-' + name)))
            self.assertEqual(out.name, 'AGENTS.md')
            self.assertIn(runtime.BEGIN, out.read_text())

    def test_backup_holds_the_file_from_before_chewbacca_ever_touched_it(self):
        settings = runtime.claude_home() / 'settings.json'
        settings.parent.mkdir(parents=True)
        original = b'{"model": "mine", "hooks": {}}\n'
        settings.write_bytes(original)
        first = runtime.setup('claude-code')
        backup = settings.with_name('settings.json' + runtime.BACKUP_SUFFIX)
        self.assertIn(str(backup), first['runtimes'][0]['backups'])
        self.assertEqual(backup.read_bytes(), original)
        self.assertNotEqual(settings.read_bytes(), original)
        runtime.setup('claude-code')
        self.assertEqual(backup.read_bytes(), original)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
