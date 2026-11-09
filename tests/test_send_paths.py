"""Every outward send path in the kit is known, and each honors its gate.

2026-10-11: an inventory of origin/main found 22 send paths. Three ignored
CHEWBACCA_NO_SEND (a plan's send_text and send_email, `mac mail send` through
email_reader), and a plan's app_data *query* could run any AppleScript,
including one that sends, with no confirm at all. This test is the inventory
as code: a new file that sends without being listed here fails it, so no send
path can be added quietly. The approval-as-a-type plan that replaces the
per-path gates is docs/plans/send-approval.md.

2026-10-12: the test flipped from "listed" to "every sink calls take()". A sink
gated 'take' must call tools/send_approval.py right before it hands a message
over (tests/test_send_approval.py proves each one refuses with no press).
NOT_YET names the sinks that don't yet, and why, so the gap is on the page.
"""
import os
from pathlib import Path
import re
import subprocess
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]

# Code that hands text to another person or service. Matched on source text.
SINK = re.compile(
    r'tell application \\?"Messages\\?"[^\n]{0,200}\bsend\b'
    r'|["\']messages["\'],\s*["\']send["\']|\bmessages send\b'
    r'|["\']mail["\'],\s*["\']send["\']|\bmail send\b'
    r'|chat\.postMessage|users\.messages\.send|["\']\+send["\']'
    r'|wacli[^\n]{0,80}\bsend\b|smtplib\.SMTP')

# path -> the gate the code must still contain. NO_SEND means the
# CHEWBACCA_NO_SEND switch; the rest name the press or limit that stands in.
KNOWN = {
    'mac/lib/run_plan.py': 'take',
    'mac/lib/email_reader.py': 'take',
    'mac/lib/gmail.py': 'take',
    'mac/lib/slack.py': 'take',
    'mac/lib/matrix.py': 'take',
    'bin/lib/people/send.js': 'take',
    'bin/mac-db': 'take',
    'bin/chewbacca-clay': 'CHEWBACCA_NO_SEND',
    # kit_confirm: the six-digit code on the person's screen is the press, and
    # this is where it mints the approval `people send` then takes.
    'bin/lib/mcp-writes.js': 'mints',
    # A HUD button press delivered over hud.sock, person re-checked fresh.
    'bin/lib/surfaces/whatsapp.py': 'press',
    'bin/lib/surfaces/walks.py': 'press',
    # Replies only to the user's own handles, from a self-text.
    'bin/text-command': 'own handles',
    # Names `mac messages send` in a voice agent's tool prompt; the agent then
    # sends through the CLIs above and their gates. No sink of its own.
    'bin/hud-listen': 'prompt text',
}


# Sinks that still send without take(), each with the reason. Shrinking this
# is the rest of docs/plans/send-approval.md; growing it fails the test.
NOT_YET = {
    # Clay `reply` and gtme sends: the GTM tab was mid-launch in
    # bin/chewbacca-clay on 2026-10-12. Clay writes already need Caleb's ok.
    'bin/chewbacca-clay': 'migration step 5, GTM lane',
    # HUD surfaces send on a button press over hud.sock; they mint once the
    # HUD lane adopts send_approval.mint. Until then take() counts a send
    # under `kyber-surfaces run` with no agent above it as that press.
    'bin/lib/surfaces/whatsapp.py': 'HUD lane',
    'bin/lib/surfaces/walks.py': 'HUD lane',
    # Replies only to the user's own handles: never another person.
    'bin/text-command': 'own handles',
    # No sink of its own: prompt text naming `mac messages send`.
    'bin/hud-listen': 'prompt text',
}
# 5: gtme_solo's send moved to Dough with the gtme engine (2026-11-03); Dough's
# tests/test_engine_home.py holds it to CHEWBACCA_NO_SEND.
NOT_YET_COUNT = 5
TAKE_CALL = re.compile(r'_send_refusal\(|approval\.take\(')


def sinks():
    out = subprocess.run(['git', 'ls-files', '-z', '--', 'bin', 'tools', 'mac', 'apps', 'skills'],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout.split('\0')
    found = set()
    for rel in filter(None, out):
        path = ROOT / rel
        if 'test' in path.name or path.suffix in ('.md', '.json', '.txt', '.csv') or not path.is_file():
            continue
        try:
            text = path.read_text(errors='replace')
        except OSError:
            continue
        if SINK.search(text):
            found.add(rel)
    return found


class SendPathTests(unittest.TestCase):
    def test_every_sending_file_is_known(self):
        unknown = sorted(sinks() - set(KNOWN))
        self.assertEqual(unknown, [], 'a new send path: gate it and list it in KNOWN')

    def test_every_known_path_still_has_its_gate(self):
        for rel, gate in KNOWN.items():
            path = ROOT / rel
            if not path.exists():
                continue
            if gate == 'CHEWBACCA_NO_SEND':
                self.assertIn('CHEWBACCA_NO_SEND', path.read_text(errors='replace'), rel)

    def test_every_sink_calls_take(self):
        for rel, gate in KNOWN.items():
            if rel in NOT_YET:
                continue
            text = (ROOT / rel).read_text(errors='replace')
            if gate == 'mints':
                self.assertIn('mintPressed(', text, rel)
                continue
            self.assertEqual(gate, 'take', rel + ' sends without take() and is not in NOT_YET')
            self.assertRegex(text, TAKE_CALL, rel)
        self.assertEqual(len(NOT_YET), NOT_YET_COUNT, 'NOT_YET only shrinks: move a sink to take() instead')
        self.assertTrue(set(NOT_YET) <= set(KNOWN))

    def test_only_press_handlers_mint(self):
        out = subprocess.run(['git', 'grep', '-l', '-E', r'mintPressed\(|send_approval\.mint\(|\bsa\.mint\(',
                              '--', 'bin', 'tools', 'mac', 'apps', 'skills'],
                             cwd=ROOT, capture_output=True, text=True).stdout.split()
        self.assertEqual(sorted(out), ['bin/lib/mcp-writes.js', 'bin/lib/send-approval.js'])

    def test_a_plan_cannot_send_with_no_send_set(self):
        sys.path.insert(0, str(ROOT / 'mac/lib'))
        import run_plan
        with mock.patch.dict(os.environ, {'CHEWBACCA_NO_SEND': '1'}), \
                mock.patch.object(run_plan, '_applescript', side_effect=AssertionError('sent')):
            for action in ({'name': 'send_text', 'to': 'x', 'body': 'hi'},
                           {'name': 'send_email', 'to': 'x@y.z', 'subject': 's', 'body': 'b'}):
                with self.assertRaises(run_plan.PlanError):
                    run_plan.run_action(action, approved=True)

    def test_a_query_never_sends(self):
        sys.path.insert(0, str(ROOT / 'mac/lib'))
        import run_plan
        with mock.patch.object(run_plan, '_applescript', side_effect=AssertionError('ran')):
            with self.assertRaises(run_plan.PlanError):
                run_plan.run_query({'name': 'app_data',
                                    'script': 'tell application "Messages" to send "x" to buddy "y"'},
                                   approved=True)
            # Any script, sending or not, needs the confirm: no word list
            # proves AppleScript only reads.
            with self.assertRaises(run_plan.PlanError):
                run_plan.run_query({'name': 'app_data', 'script': 'run script "x"'})

    def test_mail_send_honors_no_send(self):
        sys.path.insert(0, str(ROOT / 'mac/lib'))
        import email_reader
        with mock.patch.dict(os.environ, {'CHEWBACCA_NO_SEND': '1'}):
            code, result = email_reader.send('a@b.co', 's', 'body',
                                             runner=mock.Mock(side_effect=AssertionError('sent')))
        self.assertEqual(code, 3)
        self.assertFalse(result['ok'])


if __name__ == '__main__':
    unittest.main()
