#!/usr/bin/env python3
"""The weekly guard false-positive report (tools/hookd_replay.py fp).

Built from synthetic transcripts in the host's own shape: an assistant row
with tool_use blocks, a user row with the tool_result the host writes when a
hook refuses ("PreToolUse:Bash hook error: [<hook command>]: <stderr>").
"""
import datetime
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import hookd_replay as hr  # noqa: E402

# The gated shape every hookd guard has had since 5dbce38e: the hook command
# holds a [ -x ] test, so its own brackets sit inside the host's [ ].
GATED = ('H="$HOME/.local/bin/hookd"; [ -x "$H" ] && exec "$H" gate /Users/x/.claude/hooks/{0}; '
         'exec /Users/x/.claude/hooks/{0}')


def refusal(hook, reason='refusing.', gated=True):
    command = GATED.format(hook) if gated else f'/Users/x/.claude/hooks/{hook}'
    return f'PreToolUse:Bash hook error: [{command}]: {hook.split(".")[0]}: {reason}'


class Transcript:
    """Write tool calls and results in order, the way the host logs them."""

    def __init__(self, folder, name='t.jsonl'):
        self.path = Path(folder) / name
        self.rows, self.n = [], 0

    def call(self, tool, data, refused_by=None, reason='refusing.', at='2026-10-12T10:00:00.000Z', gated=True):
        self.n += 1
        use_id = f'toolu_{self.n}'
        self.rows.append({'type': 'assistant', 'timestamp': at, 'message': {'content': [
            {'type': 'tool_use', 'id': use_id, 'name': tool, 'input': data}]}})
        text = refusal(refused_by, reason, gated) if refused_by else 'ok'
        self.rows.append({'type': 'user', 'timestamp': at, 'message': {'content': [
            {'type': 'tool_result', 'tool_use_id': use_id, 'content': text}]}})
        return self

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text('\n'.join(json.dumps(r) for r in self.rows) + '\n')
        return self.path


def bash(command, description='x'):
    return {'command': command, 'description': description}


class ParseTests(unittest.TestCase):
    def test_a_gated_guard_refusal_is_counted_under_its_own_name(self):
        # Before: the pattern stopped at the [ -x ]'s first ], matched nothing,
        # and 17 refusals in this shape went uncounted by 10/12 05:20.
        with tempfile.TemporaryDirectory() as tmp:
            path = Transcript(tmp).call('Bash', bash('ls'), refused_by='launch-guard.sh').save()
            calls, refused = hr.tool_events(path)
        self.assertEqual([hook for _, hook, _ in refused.values()], ['launch-guard.sh'])

    def test_a_file_that_quotes_the_format_is_not_a_refusal(self):
        quoted = '12\t  (the host writes "PreToolUse:Bash hook error: [<hook>]: ..." into'
        with tempfile.TemporaryDirectory() as tmp:
            t = Transcript(tmp)
            t.rows.append({'type': 'assistant', 'message': {'content': [
                {'type': 'tool_use', 'id': 'r1', 'name': 'Read', 'input': {'file_path': 'tools/hookd_replay.py'}}]}})
            t.rows.append({'type': 'user', 'message': {'content': [
                {'type': 'tool_result', 'tool_use_id': 'r1', 'content': quoted}]}})
            _, refused = hr.tool_events(t.save())
        self.assertEqual(refused, {})

    def test_a_dispatch_refusal_names_the_guard_that_refused(self):
        # One hookd dispatch entry lists every gated guard; the last one listed
        # is not the one that refused.
        command = ('H="$HOME/.local/bin/hookd"; [ -x "$H" ] && exec "$H" dispatch '
                   "--guard '*' 10 /x/hooks/load-guard.sh --guard '*' 5 /x/hooks/chatdb-guard.sh "
                   "--guard '*' 5 /x/hooks/wait-loop-guard.sh; exec /bin/bash /x/hooks/hookd-fallback.sh")
        for reason, want in (('chatdb-guard: refusing. raw SQL', 'chatdb-guard.sh'),
                             ('BLOCKED by load-guard: heavy work', 'load-guard.sh'),
                             ('wait-loop-guard: refusing a loop', 'wait-loop-guard.sh')):
            text = f'PreToolUse:Bash hook error: [{command}]: {reason}'
            match = hr.REFUSAL.match(text)
            self.assertEqual(hr.hook_name(match.group(3), match.group(4)), want)

    def test_an_ungated_hook_command_still_parses(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Transcript(tmp).call('Bash', bash('ls'), refused_by='chatdb-guard.sh', gated=False).save()
            _, refused = hr.tool_events(path)
        self.assertEqual([hook for _, hook, _ in refused.values()], ['chatdb-guard.sh'])


class JudgeTests(unittest.TestCase):
    def rank(self, build, fixed_at=lambda hook: ''):
        with tempfile.TemporaryDirectory() as tmp:
            build(Transcript(tmp)).save()
            return {row['hook']: row for row in hr.fp_rank(7, Path(tmp), fixed_at=fixed_at)}

    def test_an_override_on_the_next_call_is_overrode(self):
        rows = self.rank(lambda t: t
                         .call('Bash', bash('git reset --hard'), refused_by='destructive-guard.sh')
                         .call('Bash', bash('DESTRUCTIVE_OK=1 git reset --hard')))
        self.assertEqual(rows['destructive-guard.sh']['overrode'], 1)
        self.assertEqual(rows['destructive-guard.sh']['got_past'], 1)

    def test_the_same_call_again_that_passes_is_reran(self):
        rows = self.rank(lambda t: t
                         .call('Bash', bash('git init -q', 'make it'), refused_by='lesson-guard.sh')
                         .call('Bash', bash('git  init -q', 'make it, again')))
        self.assertEqual(rows['lesson-guard.sh']['reran'], 1)

    def test_a_small_fix_is_changed_not_reran(self):
        # zsh-guard asks for ${n}[ instead of $n[; doing that is compliance.
        rows = self.rank(lambda t: t
                         .call('Bash', bash('for n in a b; do grep "$n[0]" f; done'), refused_by='zsh-guard.sh')
                         .call('Bash', bash('for n in a b; do grep "${n}[0]" f; done')))
        self.assertEqual(rows['zsh-guard.sh']['reran'], 0)
        self.assertEqual(rows['zsh-guard.sh']['changed'], 1)
        self.assertEqual(rows['zsh-guard.sh']['got_past'], 0)

    def test_loading_a_skill_first_is_compliance(self):
        rows = self.rank(lambda t: t
                         .call('Bash', bash('ls'), refused_by='skill-gate.sh')
                         .call('Skill', {'skill': 'graph-engineering'})
                         .call('Bash', bash('ls')))
        self.assertEqual(rows['skill-gate.sh']['complied'], 1)

    def test_refused_again_by_the_same_guard_is_not_got_past(self):
        rows = self.rank(lambda t: t
                         .call('Bash', bash('until x; do sleep 1; done'), refused_by='wait-loop-guard.sh')
                         .call('Bash', bash('until x; do sleep 1; done'), refused_by='wait-loop-guard.sh'))
        self.assertEqual(rows['wait-loop-guard.sh']['got_past'], 0)

    def test_an_override_the_refused_call_already_had_is_not_new(self):
        rows = self.rank(lambda t: t
                         .call('Bash', bash('DESTRUCTIVE_OK=1 x; rm -rf y'), refused_by='destructive-guard.sh')
                         .call('Bash', bash('ls')))
        self.assertEqual(rows['destructive-guard.sh']['overrode'], 0)

    def test_refusals_before_the_last_behavior_change_are_not_judged(self):
        rows = self.rank(lambda t: t
                         .call('Bash', bash('ls'), refused_by='skill-gate.sh', at='2026-10-11T10:00:00.000Z')
                         .call('Bash', bash('ls'), at='2026-10-11T10:00:01.000Z')
                         .call('Bash', bash('pwd'), refused_by='skill-gate.sh', at='2026-10-12T10:00:00.000Z')
                         .call('Bash', bash('pwd'), at='2026-10-12T10:00:01.000Z'),
                         fixed_at=lambda hook: '2026-10-11T21:48:53')
        row = rows['skill-gate.sh']
        self.assertEqual((row['refused'], row['before_fix'], row['reran']), (2, 1, 1))

    def test_the_guard_got_past_most_ranks_first(self):
        def build(t):
            t.call('Bash', bash('a'), refused_by='quiet-guard.sh').call('Bash', bash('b'))
            for i in range(2):
                t.call('Bash', bash(f'git init p{i}'), refused_by='noisy-guard.sh').call('Bash', bash(f'git init p{i}'))
            return t
        with tempfile.TemporaryDirectory() as tmp:
            build(Transcript(tmp)).save()
            ranked = hr.fp_rank(7, Path(tmp), fixed_at=lambda hook: '')
        self.assertEqual([r['hook'] for r in ranked], ['noisy-guard.sh', 'quiet-guard.sh'])

    def test_a_reply_hook_is_not_ranked(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Transcript(tmp).call('Bash', bash('ls'))
            t.rows[-1]['message']['content'][0]['content'] = 'Stop hook error: [/x/prayer-guard.sh]: no prayer'
            self.assertEqual(hr.fp_rank(7, Path(t.save().parent), fixed_at=lambda hook: ''), [])


class LastChangeTests(unittest.TestCase):
    def test_comment_gate_and_prelude_edits_keep_the_week(self):
        diff = ('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-# gate: a\n+# gate: a b\n'
                '+[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"\n'
                '+\n')
        self.assertFalse(hr.behavior_changed(diff))

    def test_a_code_line_counts(self):
        self.assertTrue(hr.behavior_changed('@@ -1 +1 @@\n-exit 2\n+exit 0\n'))


class WeeklyTests(unittest.TestCase):
    def test_due_on_sunday_or_after_a_week_without_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            sunday = datetime.datetime(2026, 10, 18, 9, 0)
            monday = datetime.datetime(2026, 10, 12, 9, 0)
            self.assertTrue(hr.due(sunday, folder))
            self.assertTrue(hr.due(monday, folder), 'no report at all is overdue')
            old = folder / '2026-10-04.md'
            old.write_text('x')
            os.utime(old, (monday.timestamp() - 3 * 86400,) * 2)
            self.assertFalse(hr.due(monday, folder))
            os.utime(old, (monday.timestamp() - 8 * 86400,) * 2)
            self.assertTrue(hr.due(monday, folder))
            (folder / '2026-10-18.md').write_text('x')
            self.assertFalse(hr.due(sunday, folder), 'one report a day at most')

    def test_weekly_writes_the_report_and_files_the_top_offender(self):
        with tempfile.TemporaryDirectory() as tmp:
            projects = Path(tmp) / 'projects'
            t = Transcript(projects)
            for i in range(2):
                t.call('Bash', bash(f'sqlite3 chat.db "select count(*) from message where is_from_me={i}"'),
                       refused_by='chatdb-guard.sh')
                t.call('Bash', bash(f'RAW_MESSAGES_OK=1 sqlite3 chat.db "select count(*) from message where is_from_me={i}"'))
            t.save()
            home = Path(tmp) / 'chew'
            env = dict(os.environ, CHEWBACCA_HOME=str(home))
            run = subprocess.run([sys.executable, str(ROOT / 'tools/hookd_replay.py'), 'fp', '--weekly', '--force',
                                  '--root', str(projects), '--scope', tmp], env=env,
                                 capture_output=True, text=True, timeout=120)
            self.assertEqual(run.returncode, 0, run.stderr)
            reports = list((home / 'reports/guard-fp').glob('*.md'))
            self.assertEqual(len(reports), 1)
            self.assertIn('Top offender: chatdb-guard.sh', reports[0].read_text())
            db = sqlite3.connect(str(home / 'work-ledger.sqlite'))
            rows = db.execute("SELECT title, source_key FROM tasks WHERE source_key LIKE 'guard-fp-%'").fetchall()
            self.assertEqual(len(rows), 1)
            self.assertIn('chatdb-guard.sh', rows[0][0])
            again = subprocess.run([sys.executable, str(ROOT / 'tools/hookd_replay.py'), 'fp', '--weekly',
                                    '--root', str(projects), '--scope', tmp], env=env,
                                   capture_output=True, text=True, timeout=120)
            self.assertIn('not due', again.stdout)


if __name__ == '__main__':
    unittest.main()
