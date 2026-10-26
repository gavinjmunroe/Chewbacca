"""break-it and its Stop hook, on real done claims from 2026-10-16 and on a live repo.

The fixture holds four false-done finishes from that day (two from the steering
study's hand-labeled cases, two found by replaying every done claim against what
the same session did next) and four clean finishes. Each is the session's own
events up to the done reply, trimmed of tool output. The numbers behind the
design are in tests/fixtures/break_it/REPLAY.md.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import break_it as B  # noqa: E402

CASES = json.loads((ROOT / 'tests/fixtures/break_it/cases.json').read_text())
HOOK = ROOT / '.claude/hooks/break-it-guard.sh'


def git(repo, *args):
    subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True,
                   env=dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t',
                            GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t'))


def transcript(path, ask, events, reply):
    """A Claude Code JSONL transcript: the ask, tool calls with results, the reply."""
    lines = [{'type': 'user', 'message': {'content': ask}}]
    for n, (name, inp, error) in enumerate(events):
        tid = f't{n}'
        lines.append({'type': 'assistant', 'message': {'content': [
            {'type': 'tool_use', 'id': tid, 'name': name, 'input': inp}]}})
        lines.append({'type': 'user', 'message': {'content': [
            {'type': 'tool_result', 'tool_use_id': tid, 'is_error': error, 'content': 'out'}]}})
    lines.append({'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': reply}]}})
    Path(path).write_text('\n'.join(json.dumps(l) for l in lines) + '\n')


class RealCases(unittest.TestCase):
    def test_at_least_three_real_false_done_cases(self):
        self.assertGreaterEqual(sum(c['label'] == 'false' for c in CASES), 3)
        self.assertGreaterEqual(sum(c['label'] == 'genuine' for c in CASES), 1)

    def test_false_done_finishes_are_refused(self):
        for c in (c for c in CASES if c['label'] == 'false'):
            with self.subTest(c['source']):
                got = B.stop_verdict(c['events'], c['reply'], live=False, check_disk=False)
                self.assertTrue(got, f"{c['source']} passed: {c['reply'][-200:]}")
                self.assertEqual(sorted({b['kind'] for b in got}), c['replayed_kinds'])

    def test_clean_finishes_pass(self):
        for c in (c for c in CASES if c['label'] == 'genuine'):
            with self.subTest(c['source']):
                self.assertEqual(B.stop_verdict(c['events'], c['reply'], live=False, check_disk=False), [])

    def test_naming_a_stale_running_copy_does_not_excuse_it(self):
        # The launch-guard tab said the installed hook didn't have the change,
        # called it done anyway, and its own cd was refused an hour later.
        c = next(c for c in CASES if c['source'].startswith('auto vibrant'))
        self.assertIn('/.claude/hooks/launch-guard.sh', c['reply'])
        kinds = {b['kind'] for b in B.stop_verdict(c['events'], c['reply'], live=False, check_disk=False)}
        self.assertEqual(kinds, {'not-live'})


class Claims(unittest.TestCase):
    def test_done_words(self):
        for text in ('Done.', 'Landed as 2f97a007.', "It's on main now.", 'Pushed. Now landing the rest.',
                     "Togari's new guards are live.", 'I reran the 18 tests and all pass.'):
            self.assertTrue(B.claims_done(text), text)
        for text in ("Not landed yet, the push was refused.", "It isn't done: the probe crashed.",
                     "I'll say done once it lands.", 'Which of these two should it be?'):
            self.assertFalse(B.claims_done(text), text)

    def test_own_work_in_flight_refuses_a_done_claim(self):
        # Steering case 8 and exciting-shirley, 2026-10-16, word for word.
        for text in ("Done. The team memory note on claims is still landing in the background, "
                     "and I haven't verified it's on main yet.",
                     "Both landed. It hasn't reported back yet, so I haven't checked the chain myself."):
            got = B.stop_verdict([{'kind': 'user', 'text': 'land it'}], text, live=False, check_disk=False)
            self.assertEqual([b['kind'] for b in got], ['in-flight'], text)
        for text in ("My side's done. Still running in other tabs, not me: mapping the rest of the table.",
                     "Done. Lord, while the T renders, keep me honest about what's still waiting. Amen.",
                     "Done, landed as 2f97a007 and checked on main."):
            self.assertEqual(B.stop_verdict([{'kind': 'user', 'text': 'land it'}], text,
                                            live=False, check_disk=False), [], text)

    def test_a_negated_in_flight_line_is_not_in_flight(self):
        # The Parker tab's recap, 2026-10-25, refused on 3 replies in a row.
        text = ("Done. No Parker renders are running or queued. The roll-in polish job is killed "
                "and the render agent was told to stop.")
        self.assertEqual(B.stop_verdict([{'kind': 'user', 'text': 'stop the renders'}], text,
                                        live=False, check_disk=False), [])
        # The reply that explained this fix, word for word (2026-10-26): a quote
        # and a guard's reading of it are a report, not a status.
        text = ('All 4 fixes are on main as 99fc7633.\n\n- break-it: it read "No Parker renders are running '
                'or queued" as still running bc it ignored the "No".')
        self.assertEqual(B.stop_verdict([{'kind': 'user', 'text': 'fix it'}], text, live=False, check_disk=False), [])
        got = B.stop_verdict([{'kind': 'user', 'text': 'fix it'}], 'Done. The "no-cache" deploy is still running.',
                             live=False, check_disk=False)
        self.assertEqual([b['kind'] for b in got], ['in-flight'])
        # A negation in another clause leaves the in-flight part standing (review, 2026-10-26).
        for text in ("Done. Nothing broke, but the Railway deploy is still running.",
                     "Done. No errors and the render is still running in the background.",
                     "Done. I did not wait: the build is still running."):
            got = B.stop_verdict([{'kind': 'user', 'text': 'ship it'}], text, live=False, check_disk=False)
            self.assertEqual([b['kind'] for b in got], ['in-flight'], text)

    def test_a_check_before_the_last_write_clears_nothing(self):
        ev = [{'kind': 'user', 'text': 'land it'},
              {'kind': 'tool', 'name': 'Bash', 'id': 'a', 'error': False,
               'input': {'command': 'chewbacca break-it run --transcript t.jsonl'}},
              {'kind': 'result', 'id': 'a', 'error': False, 'text': 'nothing broke'},
              {'kind': 'tool', 'name': 'Write', 'id': 'w', 'error': False, 'input': {'file_path': '/tmp/n.md'}}]
        got = B.stop_verdict(ev, 'Done. The suite is still running.', live=False, check_disk=False)
        self.assertEqual([b['kind'] for b in got], ['in-flight'])

    def test_a_passing_check_after_the_claim_clears_in_flight(self):
        recap = "Done. The suite is still running in the background."
        ev = [{'kind': 'user', 'text': 'land it'},
              {'kind': 'tool', 'name': 'mcp__ccd_turn__wrap_up', 'id': 'w', 'input': {'recap': recap}, 'error': False}]
        self.assertEqual([b['kind'] for b in B.stop_verdict(ev, 'Done.', live=False, check_disk=False)],
                         ['in-flight'])
        for cmd, out in (('chewbacca break-it attack -m "suite finished" -- sh -c true',
                          'held  suite finished (exit 0, wanted ok)'),
                         ('chewbacca break-it run --transcript t.jsonl', 'break-it (full) on abc\nnothing broke')):
            with self.subTest(cmd):
                ran = ev + [{'kind': 'tool', 'name': 'Bash', 'id': 'a', 'input': {'command': cmd}, 'error': False},
                            {'kind': 'result', 'id': 'a', 'error': False, 'text': out}]
                self.assertEqual(B.stop_verdict(ran, 'Checked again.', live=False, check_disk=False), [])
        broke = ev + [{'kind': 'tool', 'name': 'Bash', 'id': 'a', 'error': False,
                       'input': {'command': 'chewbacca break-it attack -m "suite finished" -- false'}},
                      {'kind': 'result', 'id': 'a', 'error': False, 'text': 'BROKE suite finished (exit 1, wanted ok)'}]
        self.assertEqual([b['kind'] for b in B.stop_verdict(broke, 'Checked.', live=False, check_disk=False)],
                         ['in-flight'])

    def test_ask_reads_a_side_session_brief_behind_reminders(self):
        ev = [{'kind': 'user', 'text': '<system-reminder>worktree</system-reminder>\nBuild the thing and test it'}]
        self.assertEqual(B.asks(ev), ['Build the thing and test it'])

    def test_harness_prompts_are_not_the_ask(self):
        self.assertFalse(B.is_human('Your response above was cut off mid-stream. Resume directly.'))

    def test_a_test_claim_needs_a_test_after_the_last_code_write(self):
        ev = [{'kind': 'user', 'text': 'fix it'},
              {'kind': 'tool', 'name': 'Bash', 'input': {'command': 'python3 -m pytest tests/test_x.py'}, 'error': False},
              {'kind': 'tool', 'name': 'Edit', 'input': {'file_path': '/r/tools/x.py'}, 'error': False}]
        self.assertFalse(B.check_claims('All 12 tests pass.', ev, None, None)[0]['ok'])
        # A note written after the run does not make the run stale.
        ev2 = ev[:1] + ev[2:] + [ev[1], {'kind': 'tool', 'name': 'Write',
                                         'input': {'file_path': '/r/team/memory/note.md'}, 'error': False}]
        self.assertTrue(B.check_claims('All 12 tests pass.', ev2, None, None)[0]['ok'])


class Diff(unittest.TestCase):
    def test_greps(self):
        lines = {'tools/x.py': ['# TODO wire the real provider', "BRANDS = {'gymshark': 'frasers'}",
                                'except Exception:', '    pass',
                                '"""Built after a Sabo call on 2026-10-16."""'],
                 'docs/term.md': ['The fee is [NEED] percent.', 'Use `[NEED]` for a blank.']}
        kinds = sorted(b['kind'] for b in B.grep_diff(lines, ROOT))
        self.assertEqual(kinds, ['hard-coded-client', 'need-marker', 'swallowed-error', 'todo'])

    def test_a_line_describing_the_patterns_is_not_a_todo(self):
        lines = {'.claude/hooks/x.sh': ['#   grepped for TODO, [NEED, client names and swallowed errors']}
        self.assertEqual(B.grep_diff(lines, ROOT), [])

    def test_touched_tests_skip_the_runner_and_match_case_exactly(self):
        got = B.touched_tests(ROOT, ['tests/run.sh', 'team/memory/MEMORY.md', 'tools/break_it.py'])
        self.assertEqual(got, ['tests/test_break_it.py'])

    def test_shared_generated_files_are_not_another_tab(self):
        self.assertEqual(B.others_after(ROOT, 'origin/main', ['SHA256SUMS.txt', 'team/memory/MEMORY.md']), [])

    def test_need_markers_never_block(self):
        self.assertNotIn('need-marker', B.BLOCKING)


class EdgeProbes(unittest.TestCase):
    def test_garbage_stdin_traceback_is_a_break(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            (repo / 'tools').mkdir()
            (repo / 'tools/plan.py').write_text(
                'import argparse, json, sys\n'
                'p = argparse.ArgumentParser(); s = p.add_subparsers(dest="c")\n'
                's.add_parser("plan").add_argument("src")\n'
                'a = p.parse_args()\n'
                'if __name__ == "__main__":\n'
                '    data = json.load(sys.stdin if a.src == "-" else open(a.src))\n'
                '    print(data.get("x"))\n')
            broke = [r for r in B.edge_attacks(repo, ['tools/plan.py'], timeout=20) if not r['ok']]
            self.assertTrue(any('garbage stdin' in r['what'] for r in broke), broke)

    def test_probes_get_no_secrets(self):
        os.environ['BREAK_IT_TEST_SECRET'] = 'x'
        self.assertNotIn('BREAK_IT_TEST_SECRET', B.probe_env('/tmp/h'))

    def test_case_nine_breaks_at_the_commit_called_done(self):
        # next_move.py landed as done with 20 green tests at 2f97a007; `plan -`
        # fed garbage crashed. 045cb4b5 fixed it after a manual break-it pass.
        if subprocess.run(['git', '-C', str(ROOT), 'cat-file', '-e', '2f97a007^{commit}'],
                          capture_output=True).returncode:
            self.skipTest('history without 2f97a007')
        with tempfile.TemporaryDirectory() as tmp:
            wt = Path(tmp) / 'wt'
            git(ROOT, 'worktree', 'add', '--detach', str(wt), '2f97a007')
            try:
                broke = [r for r in B.edge_attacks(wt, ['tools/next_move.py'], timeout=30) if not r['ok']]
            finally:
                git(ROOT, 'worktree', 'remove', '--force', str(wt))
        self.assertTrue(any(r['what'].startswith('tools/next_move.py plan') for r in broke), broke)


class LiveHook(unittest.TestCase):
    """The shell hook on a real repository: refuse, fix, pass."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.repo = t / 'repo'
        self.repo.mkdir()
        git(self.repo, 'init', '-q')
        (self.repo / 'README.md').write_text('x\n')
        git(self.repo, 'add', 'README.md')
        git(self.repo, 'commit', '-q', '-m', 'init')
        self.env = dict(os.environ, HOME=str(t / 'home'), TMPDIR=str(t), CHEWBACCA_LOG_DIR=str(t / 'logs'))
        (t / 'home').mkdir()
        self.tr = t / 'session.jsonl'

    def tearDown(self):
        self.tmp.cleanup()

    def stop(self, reply, prompt_id):
        payload = {'last_assistant_message': reply, 'transcript_path': str(self.tr),
                   'prompt_id': prompt_id, 'cwd': str(self.repo)}
        return subprocess.run(['bash', str(HOOK)], input=json.dumps(payload), capture_output=True,
                              text=True, env=self.env, timeout=60)

    def test_refuses_then_passes(self):
        tool = self.repo / 'tools/count.py'
        tool.parent.mkdir()
        tool.write_text('print(1)\n')
        reply = 'Done, count.py is in and the run printed 1.'
        transcript(self.tr, 'Add a count tool and run it', [
            ('Write', {'file_path': str(tool), 'content': 'print(1)\n'}, False),
            ('Bash', {'command': f'python3 {tool}'}, False)], reply)
        r = self.stop(reply, 'p1')
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn('uncommitted', r.stderr)
        # Once per turn: the same prompt id never refuses twice.
        self.assertEqual(self.stop(reply, 'p1').returncode, 0)
        git(self.repo, 'add', 'tools/count.py')
        git(self.repo, 'commit', '-q', '-m', 'count')
        transcript(self.tr, 'Add a count tool and run it', [
            ('Write', {'file_path': str(tool), 'content': 'print(1)\n'}, False),
            ('Bash', {'command': f'python3 {tool}'}, False),
            ('Bash', {'command': 'git commit -m count'}, False)], reply)
        r = self.stop(reply, 'p2')
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_no_done_claim_no_check(self):
        transcript(self.tr, 'look', [('Write', {'file_path': str(self.repo / 'a.py'), 'content': 'x'}, False)],
                   'I changed a.py, nothing is run yet.')
        self.assertEqual(self.stop('I changed a.py, nothing is run yet.', 'p3').returncode, 0)

    def test_receipt_flow(self):
        (self.repo / 'bin').mkdir()
        cli = self.repo / 'bin/hello'
        cli.write_text('#!/bin/sh\necho hi\n')
        cli.chmod(0o755)
        git(self.repo, 'add', 'bin/hello')
        git(self.repo, 'commit', '-q', '-m', 'hello')
        attack = B.main(['attack', '--repo', str(self.repo), '-m', 'the real example prints hi', '--',
                         'sh', '-c', 'bin/hello | grep -q hi'])
        self.assertEqual(attack, 0)
        self.assertEqual(B.main(['run', '--repo', str(self.repo), '--ask', 'add a hello command that prints hi',
                                 '--no-base', '--no-write']), 0)
        self.assertEqual(B.main(['run', '--repo', str(self.repo), '--ask', 'add a hello command that prints hi',
                                 '--no-base']), 0)
        r = subprocess.run([sys.executable, str(ROOT / 'tools/break_it.py'), 'check', '--repo', str(self.repo)],
                           capture_output=True, text=True, input='')
        self.assertEqual(r.returncode, 0, r.stdout)
        # An edit after the attack makes the receipt stale.
        cli.write_text('#!/bin/sh\necho bye\n')
        r = subprocess.run([sys.executable, str(ROOT / 'tools/break_it.py'), 'check', '--repo', str(self.repo)],
                           capture_output=True, text=True, input='')
        self.assertEqual(r.returncode, 1)

    def test_garbage_payload_is_silent(self):
        # The break-it pass on this hook's own change: jq printed a parse error
        # into the transcript on a payload that was not JSON.
        r = subprocess.run(['bash', str(HOOK)], input='not json', capture_output=True, text=True,
                           env=self.env, timeout=60)
        self.assertEqual((r.returncode, r.stderr), (0, ''))

    def test_check_outside_a_repo_certifies_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(B.main(['check', '--repo', tmp]), 1)

    def test_installed_copy_finds_the_kit_runtime(self):
        # An installed hook lives in ~/.claude/hooks, away from any checkout.
        home = Path(self.env['HOME'])
        (home / '.claude/hooks').mkdir(parents=True)
        installed = home / '.claude/hooks/break-it-guard.sh'
        installed.write_text(HOOK.read_text())
        tool = home / '.chewbacca/kit/current/tools/break_it.py'
        tool.parent.mkdir(parents=True)
        tool.write_text('import sys\nsys.stdin.read()\nprint("kit runtime ran", file=sys.stderr)\nsys.exit(2)\n')
        env = dict(self.env)
        env.pop('CHEWBACCA_REPO_DIR', None)
        r = subprocess.run(['bash', str(installed)], input=json.dumps({'last_assistant_message': 'Done.',
                           'prompt_id': 'k1'}), capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn('kit runtime ran', r.stderr)

    def test_foreign_repo_is_never_probed(self):
        self.assertFalse(B.trusted_repo(self.repo))


if __name__ == '__main__':
    unittest.main()
