"""Every outward send path in the kit is known, and each honors its gate.

2026-10-11: an inventory of origin/main found 22 send paths. Three ignored
CHEWBACCA_NO_SEND (a plan's send_text and send_email, `mac mail send` through
email_reader), and a plan's app_data *query* could run any AppleScript,
including one that sends, with no confirm at all. This test is the inventory
as code: a new file that sends without being listed here fails it, so no send
path can be added quietly. The approval-as-a-type plan that replaces the
per-path gates is docs/plans/send-approval.md.
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
    'mac/lib/run_plan.py': 'CHEWBACCA_NO_SEND',
    'mac/lib/email_reader.py': 'CHEWBACCA_NO_SEND',
    'mac/lib/gmail.py': 'CHEWBACCA_NO_SEND',
    'mac/lib/slack.py': 'CHEWBACCA_NO_SEND',
    'mac/lib/matrix.py': 'CHEWBACCA_NO_SEND',
    'bin/lib/people/send.js': 'CHEWBACCA_NO_SEND',
    'bin/mac-db': 'CHEWBACCA_NO_SEND',
    'tools/gtme_solo.py': 'CHEWBACCA_NO_SEND',
    'bin/chewbacca-clay': 'CHEWBACCA_NO_SEND',
    'bin/lib/mcp-writes.js': 'CHEWBACCA_NO_SEND',
    # A HUD button press delivered over hud.sock, person re-checked fresh.
    'bin/lib/surfaces/whatsapp.py': 'press',
    'bin/lib/surfaces/walks.py': 'press',
    # Replies only to the user's own handles, from a self-text.
    'bin/text-command': 'own handles',
    # Names `mac messages send` in a voice agent's tool prompt; the agent then
    # sends through the CLIs above and their gates. No sink of its own.
    'bin/hud-listen': 'prompt text',
}


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
                                    'script': 'tell application "Messages" to send "x" to buddy "y"'})

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
