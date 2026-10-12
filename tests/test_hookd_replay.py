"""The hookd replay, in the suite: a guard that gains a trigger without its
gate word fails here.

hookd skips a gated guard when a Bash call names none of the guard's
`# gate:` words (2026-10-11, 48050857). A refusal added to a guard without a
matching gate word is then skipped in silence. tools/hookd_replay.py parity
caught that over 7 days of transcripts, but only when someone ran it by hand,
and nothing in CI has transcripts. This replays a sanitized fixture of 800
real calls instead: every call the gate would skip goes through the guard's
own body, which must exit 0 and print nothing.

A guard whose file, lib.sh, the gate code and the fixture are unchanged since
its last clean replay on this machine is not replayed again, so the suite
pays only for the guard that changed. CHEWBACCA_PARITY_FRESH=1 replays all."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CRATE = ROOT / 'crates/hookd'
HOOKS = ROOT / '.claude/hooks'
CORPUS = ROOT / 'tests/fixtures/hookd-replay/bash.jsonl'
REPLAY = ROOT / 'tools/hookd_replay.py'
# One build dir per checkout. Shared, a test in another worktree (or
# another tab on main) relinked release/hookd from its own source, and
# this checkout's tests ran that binary (2026-10-12).
TARGET = Path(tempfile.gettempdir()) / ('chewbacca-hookd-test-target-' + hashlib.sha1(str(ROOT).encode()).hexdigest()[:10])
PASSED = Path(tempfile.gettempdir()) / 'chewbacca-hookd-parity'
# Four guard runs at once: a full cold replay of 13 guards measured 2026-10-12
# took ~4 min at 4 jobs and load 11; one changed guard takes ~20 s.
JOBS = int(os.environ.get('CHEWBACCA_PARITY_JOBS', '4'))

sys.path.insert(0, str(ROOT / 'tools'))
import hookd_replay  # noqa: E402


def build():
    if not shutil.which('cargo'):
        return None
    subprocess.run(['cargo', 'build', '--quiet', '--release', '--manifest-path', str(CRATE / 'Cargo.toml')],
                   env=dict(os.environ, CARGO_TARGET_DIR=str(TARGET)), check=True, timeout=600)
    return TARGET / 'release/hookd'


HOOKD = build()


def replay(hooks, only, *extra):
    return subprocess.run([sys.executable, str(REPLAY), 'parity', '--corpus', str(CORPUS),
                           '--hooks', str(hooks), '--hookd', str(HOOKD), '--only', only,
                           '--limit', '100000', '--jobs', str(JOBS), '--json', *extra],
                          capture_output=True, text=True, timeout=1800)


def fingerprint(guard):
    """Everything a guard's replay verdict depends on, hashed."""
    digest = hashlib.sha256()
    for path in [guard, HOOKS / 'lib.sh', CORPUS, REPLAY, *sorted((CRATE / 'src').glob('*.rs'))]:
        digest.update(path.name.encode() + b'\0' + path.read_bytes() + b'\0')
    return digest.hexdigest()[:24]


class CorpusTests(unittest.TestCase):
    def test_the_corpus_holds_shapes_not_people(self):
        rows = [json.loads(line) for line in CORPUS.read_text().splitlines()]
        self.assertGreaterEqual(len(rows), 500)
        for row in rows:
            self.assertEqual(sorted(row), ['command', 'cwd'])
            self.assertTrue(row['cwd'].startswith('~'), row['cwd'])
            self.assertNotRegex(row['command'], r'/Users/[^/\s]+')
            self.assertIsNone(hookd_replay.PERSONAL.search(row['command']), row['command'][:200])

    def test_the_filter_drops_what_reads_as_a_person(self):
        for text in ['mac messages send +13105550100 "hi"', 'echo a@b.co', 'ls ~/second-brain/core',
                     'grep -E "ann|bob|cy|dee|eve" notes.txt', 'export K=sk-ant-abc123def456',
                     'cat <<EOF > x', 'grep -i bipolar x', 'geocode 1234 Elmwood']:
            self.assertIsNotNone(hookd_replay.PERSONAL.search(text), text)
        for text in ['git status --short', 'grep -n "a\\|b" x.py | head -3', 'sed -n 1,200p setup.sh']:
            self.assertIsNone(hookd_replay.PERSONAL.search(text), text)


@unittest.skipIf(HOOKD is None, 'no cargo on this machine')
class ParityTests(unittest.TestCase):
    def test_every_gated_guard_acts_only_on_calls_its_gate_runs(self):
        guards = hookd_replay.gated_hooks(HOOKS)
        self.assertGreaterEqual(len(guards), 10)
        PASSED.mkdir(exist_ok=True)
        fresh = os.environ.get('CHEWBACCA_PARITY_FRESH')
        for guard in guards:
            with self.subTest(guard=guard.name):
                stamp = PASSED / f'{guard.name}-{fingerprint(guard)}'
                if stamp.exists() and not fresh:
                    continue
                result = replay(HOOKS, guard.name)
                self.assertIn(result.returncode, (0, 1), result.stderr[-2000:])
                report = json.loads(result.stdout)
                misses = report['mismatches']
                self.assertEqual(misses, [], f'{guard.name} acted on calls its # gate: words would skip; '
                                 'add the word it needs to its header:\n' + json.dumps(misses[:5], indent=1))
                self.assertGreater(report['hooks'][guard.name]['replayed'], 0)
                stamp.touch()

    def test_a_trigger_without_its_gate_word_fails_the_replay(self):
        # The failure this file exists for, made on purpose: vercel-guard
        # learns to refuse `git push` and its header still says only vercel.
        hooks = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, hooks, True)
        shutil.copy(HOOKS / 'lib.sh', hooks / 'lib.sh')
        body = (HOOKS / 'vercel-guard.sh').read_text()
        anchor = '[ -n "$cmd" ] || exit 0\n'
        self.assertIn(anchor, body)
        trigger = "printf '%s' \"$cmd\" | grep -q 'git push' && { echo 'vercel-guard: no pushes' >&2; exit 2; }\n"
        (hooks / 'vercel-guard.sh').write_text(body.replace(anchor, anchor + trigger, 1))
        self.assertTrue(any('git push' in json.loads(line)['command'] for line in CORPUS.read_text().splitlines()),
                        'the corpus lost every git push, so this control proves nothing')
        result = replay(hooks, 'vercel-guard.sh', '--fail-fast')
        self.assertEqual(result.returncode, 1, result.stdout[-2000:] + result.stderr[-2000:])
        misses = json.loads(result.stdout)['mismatches']
        self.assertTrue(misses and all('git push' in m['command'] for m in misses), misses)

    def test_a_guard_that_acts_once_then_never_is_reported_not_failed(self):
        # A fork retry at load 19 printed from lib.sh once in 755 calls
        # (2026-10-12); a gate miss is a grep and repeats every time.
        hooks = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, hooks, True)
        once = hooks / 'once'
        (hooks / 'odd-guard.sh').write_text(
            '#!/bin/bash\n# gate: vercel\n'
            f'[ -e {once} ] && exit 0\ntouch {once}\necho blip >&2\nexit 0\n')
        result = replay(hooks, 'odd-guard.sh')
        self.assertEqual(result.returncode, 0, result.stdout[-2000:] + result.stderr[-2000:])
        report = json.loads(result.stdout)
        # Four calls run at once, so up to four can see the guard's first run.
        self.assertEqual(report['mismatches'], [])
        self.assertTrue(1 <= len(report['flaky']) <= JOBS, report['flaky'])

    def test_an_unchanged_guard_passes_with_its_gate_word_added(self):
        # The same new trigger, declared: the replay must not flag it.
        hooks = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, hooks, True)
        shutil.copy(HOOKS / 'lib.sh', hooks / 'lib.sh')
        body = (HOOKS / 'vercel-guard.sh').read_text()
        anchor = '[ -n "$cmd" ] || exit 0\n'
        trigger = "printf '%s' \"$cmd\" | grep -q 'git push' && { echo 'vercel-guard: no pushes' >&2; exit 2; }\n"
        body = body.replace(anchor, anchor + trigger, 1).replace('# gate: vercel\n', '# gate: vercel push\n', 1)
        (hooks / 'vercel-guard.sh').write_text(body)
        result = replay(hooks, 'vercel-guard.sh', '--fail-fast')
        self.assertEqual(result.returncode, 0, result.stdout[-2000:] + result.stderr[-2000:])


if __name__ == '__main__':
    unittest.main()
