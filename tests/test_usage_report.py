"""chewbacca usage: every skill, verb, bin tool, slash command and hook gets a
30-day count from transcripts, the verdict log and the jobs queue.

2026-10-13: Caleb's answer to "what do you use" was "I would hope everything",
and the only count anyone had was a by-hand read of 6,988 transcripts that
afternoon (44 of 138 skills never loaded). These pin the sources, the window,
the test-row filter, and that a rotated-away verdict log keeps its counts.
Hermetic: a scratch HOME and a stand-in kit root, never the real logs.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

SESSION = '0f0e0d0c-1111-2222-3333-444455556666'


def stamp(seconds_ago=0):
    return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(time.time() - seconds_ago))


def jsonl(path, rows, age_days=0):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(''.join(json.dumps(r) + '\n' for r in rows))
    if age_days:
        old = time.time() - age_days * 86400
        os.utime(path, (old, old))


def tool_use(name, data, seconds_ago=0):
    return {'type': 'assistant', 'timestamp': stamp(seconds_ago),
            'message': {'content': [{'type': 'tool_use', 'id': 't1', 'name': name, 'input': data}]}}


class Usage(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.home = self.tmp / 'home'
        self.kit = self.home / '.chewbacca'
        self.logs = self.tmp / 'logs'
        self.root = self.tmp / 'root'
        for d in (self.home, self.logs, self.root / 'bin', self.root / 'skills', self.root / '.claude/commands'):
            d.mkdir(parents=True, exist_ok=True)
        (self.root / 'bin/chewbacca').write_text(
            'COMMANDS=(\n  "land|put files on main"\n  "gtme|growth engineer"\n  "where|print it"\n)\n'
            'case "$1" in\nmachine)\n  ;;\nesac\n')
        for tool in ('slop-check', 'list-gate', 'never-used-tool'):
            path = self.root / 'bin' / tool
            path.write_text('#!/bin/sh\n')
            path.chmod(0o755)
        for skill in ('coursework', 'gtm-engineering', 'dusty'):
            (self.root / 'skills' / skill).mkdir()
            (self.root / 'skills' / skill / 'SKILL.md').write_text('---\nname: %s\n---\n' % skill)
        pack = self.tmp / 'Projects/somepack/skills/borrowed'
        pack.mkdir(parents=True)
        (pack / 'SKILL.md').write_text('x')
        (self.home / '.claude/skills').mkdir(parents=True)
        os.symlink(pack, self.home / '.claude/skills/borrowed')
        for cmd in ('ship', 'brief'):
            (self.root / '.claude/commands' / ('%s.md' % cmd)).write_text('x')
        hooks_dir = self.home / '.claude/hooks'
        hooks_dir.mkdir(parents=True)
        (hooks_dir / 'launch-guard.sh').write_text('. lib.sh; hook_init launch-guard.sh 10\n')
        (hooks_dir / 'quiet.sh').write_text('. lib.sh  # sources it, never starts a row\necho hi\n')
        (hooks_dir / 'prayer-guard.sh').write_text('. lib.sh; hook_init prayer-guard.sh 5\n')
        (hooks_dir / 'silent-guard.sh').write_text('. lib.sh; hook_init silent-guard.sh 5\n')
        settings = {'hooks': {
            'PreToolUse': [{'hooks': [{'command': 'H="$HOME/.local/bin/hookd"; exec "$H" gate %s/launch-guard.sh' % hooks_dir},
                                      {'command': 'bash %s/silent-guard.sh' % hooks_dir}]}],
            'Stop': [{'hooks': [{'command': 'bash %s/prayer-guard.sh' % hooks_dir}]}],
            'UserPromptSubmit': [{'hooks': [{'command': 'bash %s/quiet.sh' % hooks_dir},
                                            {'command': 'bash %s/skill-route.sh' % hooks_dir}]}],
        }}
        (self.home / '.claude/settings.json').write_text(json.dumps(settings))
        self.env = mock.patch.dict(os.environ, {'HOME': str(self.home), 'CHEWBACCA_HOME': str(self.kit),
                                                'CHEWBACCA_LOG_DIR': str(self.logs)})
        self.env.start()
        os.environ.pop('CHEWBACCA_VERDICT_LOG', None)
        import usage_report
        self.mod = usage_report

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def transcripts(self):
        projects = self.home / '.claude/projects/-x'
        refusal = ('PreToolUse:Bash hook error: [H="$HOME/.local/bin/hookd"; exec "$H" gate '
                   '/h/launch-guard.sh]: launch-guard: refusing a shell command')
        jsonl(projects / 'a.jsonl', [
            tool_use('Skill', {'skill': 'coursework'}),
            tool_use('Skill', {'skill': 'plugin:coursework'}),
            tool_use('Read', {'file_path': '/Users/x/code/chewbacca/skills/gtm-engineering/SKILL.md'}),
            tool_use('Bash', {'command': 'cd /x && CHEWBACCA_NO_SEND=1 chewbacca land --paths a -m b; slop-check f.md | head'}),
            tool_use('Bash', {'command': 'python3 /x/bin/list-gate --json'}),
            {'type': 'user', 'timestamp': stamp(), 'message': {'content': '<command-name>/ship</command-name>'}},
            {'type': 'user', 'timestamp': stamp(), 'message': {'content': [
                {'type': 'tool_result', 'tool_use_id': 't1', 'content': refusal}]}},
            {'type': 'attachment', 'timestamp': stamp(), 'attachment': {
                'type': 'hook_blocking_error', 'hookEvent': 'Stop',
                'blockingError': {'blockingError': '[bash /h/prayer-guard.sh]: prayer-guard: no prayer'}}},
        ])
        # Older than the window: none of this may count.
        jsonl(projects / 'old.jsonl', [tool_use('Skill', {'skill': 'dusty'}, seconds_ago=40 * 86400)], age_days=40)
        codex = self.home / '.codex/sessions/2026/10/13/rollout.jsonl'
        jsonl(codex, [{'timestamp': stamp(), 'type': 'response_item', 'payload': {
            'type': 'custom_tool_call', 'name': 'exec',
            'input': 'text(await tools.exec_command({cmd:"cat /u/.agents/skills/coursework/SKILL.md && chewbacca gtme next"}))'}}])

    def verdict_rows(self, rows):
        now = int(time.time() * 1000)
        with open(self.logs / 'verdicts.tsv', 'a') as fh:
            for i, (kind, name, decision, session, reason) in enumerate(rows):
                fh.write('\t'.join([str(now + i), kind, name, 'PreToolUse', decision, '5', session, '', reason]) + '\n')

    def jobs(self):
        job = self.kit / 'jobs/1013-1'
        job.mkdir(parents=True)
        (job / 'job.json').write_text(json.dumps({'cmd': ['python3', '-I', '/k/bin/list-gate', 'x'],
                                                  'created': time.time()}))
        old = self.kit / 'jobs/0901-1'
        old.mkdir(parents=True)
        (old / 'job.json').write_text(json.dumps({'cmd': ['/k/bin/never-used-tool'], 'created': time.time() - 40 * 86400}))

    def build(self):
        return self.mod.build(str(self.root), days=30)

    def row(self, report, section, name):
        return next(r for r in report[section] if r['name'] == name)

    def test_skills_count_loads_and_routing_and_name_the_untouched(self):
        self.transcripts()
        self.verdict_rows([('router', 'skill-route.sh', 'route', SESSION, 'shown: gtm-engineering, borrowed; top: x 0.5')])
        report = self.build()
        self.assertEqual(self.row(report, 'skills', 'coursework')['loads'], 3)
        self.assertEqual(self.row(report, 'skills', 'gtm-engineering')['loads'], 1)
        self.assertEqual(self.row(report, 'skills', 'gtm-engineering')['routed'], 1)
        borrowed = self.row(report, 'skills', 'borrowed')
        self.assertEqual((borrowed['loads'], borrowed['routed'], borrowed['source']), (0, 1, 'somepack'))
        self.assertEqual(self.row(report, 'skills', 'dusty')['loads'], 0, 'a 40-day-old load counted')
        text = self.mod.markdown(report)
        self.assertIn('dusty', text.split('Nobody touched:')[1])
        self.assertIn('borrowed (1)', text)

    def test_verbs_tools_slash_and_jobs(self):
        self.transcripts()
        self.jobs()
        report = self.build()
        self.assertEqual(self.row(report, 'verbs', 'land')['calls'], 1)
        self.assertEqual(self.row(report, 'verbs', 'gtme')['calls'], 1, 'the Codex call was missed')
        self.assertEqual(self.row(report, 'verbs', 'where')['calls'], 0)
        self.assertIn('machine', [r['name'] for r in report['verbs']], 'case labels are verbs too')
        self.assertEqual(self.row(report, 'bin', 'slop-check')['calls'], 1)
        gate = self.row(report, 'bin', 'list-gate')
        self.assertEqual((gate['calls'], gate['jobs']), (1, 1))
        self.assertEqual(self.row(report, 'bin', 'never-used-tool')['jobs'], 0, 'a 40-day-old job counted')
        self.assertEqual(self.row(report, 'slash', 'ship')['calls'], 1)
        self.assertEqual(self.row(report, 'slash', 'brief')['calls'], 0)
        self.assertEqual(report['coverage']['jobs'], 1)

    def test_hooks_runs_refusals_and_test_rows_dropped(self):
        self.transcripts()
        self.verdict_rows([
            ('hook', 'launch-guard.sh', 'allow', SESSION, ''),
            ('hook', 'launch-guard.sh', 'refuse', SESSION, 'refusing'),
            ('hook', 'launch-guard.sh', 'refuse', 's', 'a test run'),
            ('hook', 'block.sh', 'refuse', '', 'fixture'),
            ('router', 'skill-route', 'skip', SESSION, ''),
        ])
        report = self.build()
        launch = self.row(report, 'hooks', 'launch-guard.sh')
        self.assertEqual((launch['runs'], launch['refusals_logged'], launch['refused_seen']), (2, 1, 1))
        self.assertTrue(launch['logged'])
        self.assertEqual(self.row(report, 'hooks', 'prayer-guard.sh')['refused_seen'], 1, 'Stop refusals missed')
        self.assertEqual(self.row(report, 'hooks', 'skill-route.sh')['runs'], 1, 'router runs logged by stem')
        self.assertFalse(self.row(report, 'hooks', 'quiet.sh')['logged'])
        self.assertIn('block.sh', report['hooks_unregistered_in_log'])
        text = self.mod.markdown(report)
        self.assertIn('silent-guard.sh', text.split('Never ran in the logged days')[1].split('\n')[0])
        self.assertIn('quiet.sh', text.split('a zero here means unknown:')[1].split('\n')[0])

    def test_rollup_outlives_the_verdict_log_and_never_double_counts(self):
        self.verdict_rows([('hook', 'launch-guard.sh', 'allow', SESSION, '')] * 3)
        self.assertEqual(self.row(self.build(), 'hooks', 'launch-guard.sh')['runs'], 3)
        self.assertEqual(self.row(self.build(), 'hooks', 'launch-guard.sh')['runs'], 3, 'a rerun counted rows twice')
        (self.logs / 'verdicts.tsv').unlink()  # rotated and deleted after eight days
        self.assertEqual(self.row(self.build(), 'hooks', 'launch-guard.sh')['runs'], 3)
        self.verdict_rows([('hook', 'launch-guard.sh', 'allow', SESSION, '')])
        self.assertEqual(self.row(self.build(), 'hooks', 'launch-guard.sh')['runs'], 4)

    def test_cache_rereads_only_a_changed_transcript(self):
        self.transcripts()
        self.assertEqual(self.row(self.build(), 'verbs', 'land')['calls'], 1)
        path = self.home / '.claude/projects/-x/a.jsonl'
        with mock.patch.object(self.mod, 'scan_file', side_effect=AssertionError('reread an unchanged file')):
            self.assertEqual(self.row(self.build(), 'verbs', 'land')['calls'], 1)
        with open(path, 'a') as fh:
            fh.write(json.dumps(tool_use('Bash', {'command': 'chewbacca land x'})) + '\n')
        self.assertEqual(self.row(self.build(), 'verbs', 'land')['calls'], 2)

    def test_daily_writes_the_weekly_report_once(self):
        self.transcripts()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.mod.main(['--daily', '--root', str(self.root)]), 0)
        reports = list((self.kit / 'reports/usage').glob('*.md'))
        self.assertEqual(len(reports), 1, 'no report on the first daily run')
        self.assertIn('# What got used, last 30 days', reports[0].read_text())
        first = reports[0].stat().st_mtime
        with contextlib.redirect_stdout(io.StringIO()):
            self.mod.main(['--daily', '--root', str(self.root)])
        self.assertEqual(reports[0].stat().st_mtime, first, 'the daily run rewrote a report it had today')

    def test_chewbacca_usage_is_wired(self):
        self.transcripts()
        env = dict(os.environ, CHEWBACCA_ROOT=str(ROOT))
        out = subprocess.run(['bash', str(ROOT / 'bin/chewbacca'), 'usage', '--json', '--root', str(self.root)],
                             capture_output=True, text=True, env=env, timeout=120)
        self.assertEqual(out.returncode, 0, out.stderr)
        data = json.loads(out.stdout)
        self.assertEqual(data['summary']['skills'], 4)
        help_text = subprocess.run(['bash', str(ROOT / 'bin/chewbacca'), '--help'],
                                   capture_output=True, text=True, env=env).stdout
        self.assertIn('chewbacca usage', help_text)


if __name__ == '__main__':
    unittest.main()
