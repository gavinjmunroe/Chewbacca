"""hookd terminal-event writes the agent board's rows the way Python does.

terminal-loop.sh ran `chewie terminal hook` (bash, then python3) on every tool
call to append one line to ~/.bob/memory/agent-events.jsonl, 0.08 s of CPU and
96 ms of wall before and after every Bash call on 2026-10-12. hookd now writes
the PreToolUse and PostToolUse rows itself and hands everything else back to
the Python in mac/lib/terminal_events.py, which stays the reference.

Each case runs twice from the same starting state: once through the Python
directly, once through hookd and terminal-loop.sh. The files must match line
for line, the time stamp aside. A change to the Python's rows that the Rust
doesn't follow fails here.

    python3 tests/test_hookd_terminal.py
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CRATE = ROOT / 'crates/hookd'
LOOP = ROOT / '.claude/hooks/terminal-loop.sh'
PYTHON_HOOK = ROOT / 'mac/lib/terminal.py'
# One build dir per checkout (see tests/test_hookd.py).
TARGET = Path(tempfile.gettempdir()) / ('chewbacca-hookd-terminal-' + hashlib.sha1(str(ROOT).encode()).hexdigest()[:10])


def build():
    if not shutil.which('cargo'):
        return None
    subprocess.run(['cargo', 'build', '--quiet', '--release', '--manifest-path', str(CRATE / 'Cargo.toml')],
                   env=dict(os.environ, CARGO_TARGET_DIR=str(TARGET)), check=True, timeout=600)
    return TARGET / 'release/hookd'


HOOKD = build()


def modern_python():
    """A python3 that can import mac/lib/terminal.py (3.10 syntax). On this
    Mac /usr/bin/python3 is 3.9, and in a session whose PATH finds it first the
    terminal hook fails at import and writes nothing (seen 2026-10-12)."""
    for cand in [shutil.which('python3'), '/opt/homebrew/bin/python3', '/usr/local/bin/python3']:
        if not cand or not os.path.exists(cand):
            continue
        out = subprocess.run([cand, '-c', 'import sys; print(sys.version_info >= (3, 10))'],
                             capture_output=True, text=True)
        if out.stdout.strip() == 'True':
            return cand
    return None


PY3 = modern_python()
SESSION = '6164d1fb-a8f1-4dd6-9649-9b63eb2df9d0'
T = re.compile(r'^\{"t": [0-9.e+-]+, ')


def event(name='PreToolUse', tool='Bash', tool_input=None, session=SESSION, cwd=None, **extra):
    body = {'session_id': session, 'transcript_path': '/Users/x/.claude/projects/-a/%s.jsonl' % session,
            'cwd': cwd if cwd is not None else '/', 'permission_mode': 'bypassPermissions',
            'hook_event_name': name, 'tool_name': tool,
            'tool_input': tool_input if tool_input is not None else {'command': 'ls -la', 'description': 'List'}}
    body.update(extra)
    return json.dumps(body, ensure_ascii=False)


@unittest.skipIf(HOOKD is None or PY3 is None, 'needs cargo and python 3.10+')
class TerminalEventTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.home = self.temp / 'home'
        (self.home / '.local/bin').mkdir(parents=True)
        (self.home / '.chewbacca').mkdir()
        shutil.copy(HOOKD, self.home / '.local/bin/hookd')
        (self.home / '.chewbacca/hookd-terminal-event').write_text('')
        # chewie resolves to this checkout, so the fallback runs this Python.
        bindir = self.temp / 'bin'
        bindir.mkdir()
        (bindir / 'chewie').symlink_to(ROOT / 'mac/bin/chewie')
        (bindir / 'python3').symlink_to(PY3)
        self.path = str(bindir) + os.pathsep + os.environ.get('PATH', '')
        self.project = self.temp / 'project'
        self.project.mkdir()

    def memory(self, name, tty='/dev/ttys004', project=True, gone_project=False, want=None):
        mem = self.temp / name
        shutil.rmtree(mem, ignore_errors=True)
        (mem / 'agent-ttys').mkdir(parents=True)
        if tty is not None:
            (mem / 'agent-ttys' / SESSION).write_text(tty + '\n')
        if project:
            (mem / 'project.json').write_text(json.dumps({'cwd': str(self.project)}))
        if gone_project:
            # Both sides gone: only Python's realpath can say whether they meet.
            (mem / 'project.json').write_text(json.dumps({'cwd': '/no/such/dir'}))
        if want is not None:
            (mem / 'project.json').write_text(json.dumps({'cwd': want}))
        return mem

    def env(self, mem):
        return dict(os.environ, HOME=str(self.home), PATH=self.path, BOB_MEMORY_DIR=str(mem),
                    HOOKD_LOG=str(self.temp / 'trace.tsv'), CHEWBACCA_HOME=str(self.home / '.chewbacca'))

    def both(self, payload, **memory):
        """Python's files and hookd's files after the same event."""
        py, rs = self.memory('py', **memory), self.memory('rs', **memory)
        a = subprocess.run([PY3, str(PYTHON_HOOK), 'hook'], input=payload, text=True,
                           capture_output=True, env=self.env(py), timeout=60)
        b = subprocess.run(['bash', str(LOOP)], input=payload, text=True,
                           capture_output=True, env=self.env(rs), timeout=60)
        self.assertEqual((a.returncode, a.stdout), (b.returncode, b.stdout))
        return py, rs

    def same(self, py, rs):
        for name in ('agent-events.jsonl', 'terminal-events.jsonl'):
            a, b = py / name, rs / name
            self.assertEqual(a.exists(), b.exists(), name)
            if a.exists():
                left = [T.sub('{', line) for line in a.read_text().splitlines()]
                right = [T.sub('{', line) for line in b.read_text().splitlines()]
                self.assertEqual(left, right, name)
                for line in a.read_text().splitlines() + b.read_text().splitlines():
                    self.assertTrue(T.match(line), line)

    def fast(self):
        rows = (self.temp / 'trace.tsv').read_text().splitlines() if (self.temp / 'trace.tsv').exists() else []
        return [r.split('\t')[2] for r in rows]

    def test_plain_calls_match_and_skip_python(self):
        cases = [
            event(),
            event('PostToolUse', tool_response={'stdout': 'x'}),
            event(tool='Edit', tool_input={'file_path': '/a/b/c.md', 'old_string': 'x'}),
            event(tool='Write', tool_input={'file_path': '/a/b/./'}),
            event(tool='Read', tool_input={'file_path': ''}),
            event(tool='Agent', tool_input={'description': '  Find\tthe  thing  '}),
            event(tool='mcp__peekaboo__click', tool_input={'x': 1}),
            event(tool_input={'command': 'echo "q\\" é    \x1f end' + 'x' * 120}),
            event(tool_input={'command': 'printf "\\b\\f\x01"\n  && ls'}),
            event(tool_input=None, cwd=str(self.project)),
            event(cwd=str(self.project) + '/'),
            event(tool_input='not a dict'),
            event(cwd=''),
            event(cwd='/no/such/dir'),                      # gone, the remembered tab there
        ]
        for payload in cases:
            with self.subTest(payload[:120]):
                (self.temp / 'trace.tsv').unlink(missing_ok=True)
                py, rs = self.both(payload)
                self.same(py, rs)
                self.assertEqual(self.fast(), ['skip'])
                shutil.rmtree(py)
                shutil.rmtree(rs)

    def test_everything_else_goes_to_python_and_still_matches(self):
        cases = [
            (event('SessionEnd'), {}),
            (event('Stop', last_assistant_message='Done. More.'), {}),
            (event(session='bad id!'), {}),
            (event(tool_input={'command': 5}), {}),
            (event(cwd='/no/such/dir'), {'project': False, 'gone_project': True}),
            (event(cwd=7), {}),
            ('not json', {}),
        ]
        for payload, memory in cases:
            with self.subTest(payload[:80]):
                (self.temp / 'trace.tsv').unlink(missing_ok=True)
                py, rs = self.both(payload, **memory)
                self.same(py, rs)
                self.assertEqual(self.fast(), ['run'])
                shutil.rmtree(py)
                shutil.rmtree(rs)

    def test_a_first_event_leaves_finding_the_tty_to_python(self):
        # Which claude is above the hook decides the tty, and the two runs
        # here sit at different depths, so only the rest of the row compares.
        py, rs = self.both(event(), tty=None)
        self.assertEqual(self.fast(), ['run'])
        strip = lambda m: [re.sub(r', "tty": "[^"]*"', '', T.sub('{', l))  # noqa: E731
                           for l in (m / 'agent-events.jsonl').read_text().splitlines()]
        self.assertEqual(strip(py), strip(rs))
        self.assertTrue((rs / 'agent-ttys' / SESSION).exists())

    def test_a_dotdot_through_a_missing_folder_still_matches(self):
        # realpath("/x/nope/../project") is /x/project; canonicalize fails on
        # it. Found by review, 2026-10-12: the row in terminal-events was lost.
        want = str(self.project.parent / 'nope' / '..' / self.project.name)
        (self.temp / 'trace.tsv').unlink(missing_ok=True)
        py, rs = self.both(event(cwd=str(self.project)), want=want)
        self.same(py, rs)
        self.assertTrue((rs / 'terminal-events.jsonl').exists())

    def test_a_duplicated_key_reads_like_python(self):
        body = event(tool='Read', tool_input={'file_path': '/a/b.md'})
        body = body.replace('"tool_name": "Read"', '"tool_name": "Read", "tool_name": "Bash"')
        py, rs = self.both(body)
        self.same(py, rs)

    def test_a_remembered_tab_through_a_symlink_matches(self):
        link = self.temp / 'link'
        link.symlink_to(self.project)
        py, rs = self.both(event(cwd=str(link)))
        self.same(py, rs)
        self.assertTrue((rs / 'terminal-events.jsonl').exists())

    def test_the_log_rotates_at_the_same_size(self):
        py, rs = self.memory('py'), self.memory('rs')
        for mem in (py, rs):
            (mem / 'agent-events.jsonl').write_text('x' * 399_990 + '\n')
        payload = event()
        subprocess.run([PY3, str(PYTHON_HOOK), 'hook'], input=payload, text=True, env=self.env(py), timeout=60)
        subprocess.run(['bash', str(LOOP)], input=payload, text=True, env=self.env(rs), timeout=60)
        for mem in (py, rs):
            self.assertTrue((mem / 'agent-events.jsonl.1').exists(), mem)
            self.assertFalse((mem / 'agent-events.jsonl').exists(), mem)

    def test_without_the_marker_the_script_runs_python(self):
        # An older hookd would answer the verb with exit 0 and write nothing,
        # so the script hands over only once setup has probed the binary.
        (self.home / '.chewbacca/hookd-terminal-event').unlink()
        (self.home / '.local/bin/hookd').write_text('#!/bin/sh\necho usage >&2\nexit 0\n')
        mem = self.memory('old')
        subprocess.run(['bash', str(LOOP)], input=event(), text=True, env=self.env(mem), timeout=60)
        self.assertEqual(len((mem / 'agent-events.jsonl').read_text().splitlines()), 1)

    def test_the_probe_names_the_verb(self):
        out = subprocess.run([str(HOOKD), 'terminal-event', '--probe'], capture_output=True, text=True)
        self.assertEqual(out.stdout.strip(), 'hookd terminal-event 1')

    def test_setup_writes_the_marker_only_for_a_binary_that_answers(self):
        text = (ROOT / 'setup.sh').read_text()
        self.assertIn('terminal-event --probe 2>/dev/null)" = "hookd terminal-event 1"', text)
        self.assertIn('rm -f "$HOME/.chewbacca/hookd-terminal-event"', text)


if __name__ == '__main__':
    unittest.main()
