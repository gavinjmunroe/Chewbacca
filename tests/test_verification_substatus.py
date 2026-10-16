"""Keep provider substatus through every input shape of the send gates."""
import csv
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from gtme_presend import load_verification, verification_verdict, gate
from gtme_recovery import preview


class VerificationSubstatusTest(unittest.TestCase):
    def test_activity_bounce_wins_over_active_enrollment(self):
        snapshot = {'campaigns': [{'id': 'cam_test', 'leads': [
            {'email': 'lead@fund.example', 'status': 'active', 'terminalOutcome': None}]}]}
        holds = [{'campaign': 'cam_test', 'email': 'LEAD@fund.example', 'reason': 'sender_originated_bounce'}]
        result = preview(snapshot, {'lead@fund.example': 'valid'}, holds)[0]
        self.assertEqual(result['continuation_candidates'], [])
        self.assertEqual(result['held'][0]['reasons'], ['activity:sender_originated_bounce'])
        self.assertFalse(result['ready_to_resume'])
        with self.assertRaises(ValueError):
            preview(snapshot, {}, [dict(holds[0], campaign='cam_unknown')])
        with self.assertRaises(ValueError):
            preview(snapshot, {}, [dict(holds[0], email='')])

    def test_recovery_preview_holds_risky_bounced_and_replied_leads(self):
        leads = [{'email': email, 'status': 'active', 'terminalOutcome': outcome}
                 for email, outcome in [('risky@fund.example', None),
                                         ('bounced@fund.example', 'bounced'),
                                         ('replied@fund.example', 'replied'),
                                         ('safe@fund.example', None)]]
        result = preview({'campaigns': [{'id': 'cam_test', 'leads': leads}]},
                         {lead['email']: ('catch_all' if i == 0 else 'valid')
                          for i, lead in enumerate(leads)})[0]
        self.assertEqual(len(result['held']), 3)
        self.assertEqual(len(result['continuation_candidates']), 1)
        self.assertFalse(result['ready_to_resume'])
        with self.assertRaises(ValueError):
            preview({'campaigns': [{'id': 'cam_test', 'leads': [], 'nextCursor': 'more'}]}, {})

    def test_every_risky_substatus_overrides_valid(self):
        for substatus in ['catch_all', 'accept_all', 'accept-all', 'risky']:
            self.assertEqual(verification_verdict({'Sub Status': substatus}, 'valid'), 'catch_all')
        self.assertEqual(verification_verdict({'sub_status': ''}, 'valid'), 'valid')

    def test_duplicate_valid_cannot_erase_risky_verdict(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'verdicts.csv'
            path.write_text('email,verification,sub_status\nlead@fund.example,valid,catch_all\nlead@fund.example,valid,\n')
            self.assertEqual(load_verification(str(path)), {'lead@fund.example': 'catch_all'})

    def test_inline_substatus_cannot_be_overridden_by_valid_sidecar(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'leads.csv'
            with path.open('w') as f:
                writer = csv.DictWriter(f, fieldnames=['email', 'company', 'verification', 'sub_status'])
                writer.writeheader()
                writer.writerow({'email': 'lead@fund.example', 'company': 'Fund', 'verification': 'valid', 'sub_status': 'catch_all'})
            result = gate([str(path)], verification={'lead@fund.example': 'valid'})
            self.assertTrue(result['fails'])


if __name__ == '__main__':
    unittest.main()
