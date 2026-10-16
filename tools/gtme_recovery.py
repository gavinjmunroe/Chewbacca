"""Read-only recovery preview from provider enrollment and verifier evidence."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from gtme_presend import VERIFIED, load_verification


def preview(snapshot, verdicts, activity_holds=()):
    campaign_ids = {campaign['id'] for campaign in snapshot['campaigns']}
    holds = {}
    for item in activity_holds:
        if (not isinstance(item, dict) or item.get('campaign') not in campaign_ids
                or not str(item.get('email') or '').strip() or not item.get('reason')):
            raise ValueError('Activity hold needs a known campaign, email and reason')
        key = (item['campaign'], item['email'].strip().lower())
        holds.setdefault(key, set()).add(str(item['reason']))
    result = []
    for campaign in snapshot['campaigns']:
        if campaign.get('nextCursor'):
            raise ValueError('Enrollment snapshot is incomplete; read every page first')
        counts = Counter(str(lead.get('email') or '').strip().lower()
                         for lead in campaign['leads'])
        held, candidates = [], []
        for lead in campaign['leads']:
            email = str(lead.get('email') or '').strip().lower()
            verdict = verdicts.get(email, 'missing')
            reasons = []
            # Two sender-originated bounces on 2026-10-15 still appeared active
            # with no terminalOutcome. Negative activity evidence must win.
            reasons.extend('activity:' + reason for reason in sorted(holds.get((campaign['id'], email), ())))
            if not email or counts[email] > 1:
                reasons.append('missing or duplicate identity')
            if lead.get('terminalOutcome'):
                reasons.append(str(lead['terminalOutcome']))
            if lead.get('isPaused'):
                reasons.append('lead paused')
            if lead.get('status') != 'active':
                reasons.append('lead not active')
            if verdict not in VERIFIED:
                reasons.append('verification:' + verdict)
            item = dict(lead, email=email, verification=verdict, reasons=reasons)
            (held if reasons else candidates).append(item)
        result.append({'campaign': campaign['id'], 'enrolled': len(campaign['leads']),
                       'held': held, 'continuation_candidates': candidates,
                       'ready_to_resume': False})
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--verification', type=Path, required=True)
    parser.add_argument('--activity-holds', type=Path)
    args = parser.parse_args(argv)
    raw = args.snapshot.read_bytes()
    snapshot = json.loads(raw)
    hold_bytes = args.activity_holds.read_bytes() if args.activity_holds else None
    holds = json.loads(hold_bytes)['holds'] if hold_bytes is not None else []
    if not isinstance(holds, list):
        raise ValueError('Activity holds must be a list')
    result = preview(snapshot, load_verification(str(args.verification)), holds)
    print(json.dumps({'source_observed_at': snapshot.get('observed_at'),
                      'snapshot_sha256': hashlib.sha256(raw).hexdigest(),
                      'verification_sha256': hashlib.sha256(args.verification.read_bytes()).hexdigest(),
                      'activity_holds_sha256': hashlib.sha256(hold_bytes).hexdigest() if hold_bytes is not None else None,
                      'campaigns': result,
                      'limitations': ['Preview only; no provider edits or sends',
                                      'Sender remediation, fresh verification and continuation grade remain required',
                                      'Activity completeness is not certified; supplied negative holds cannot authorize a send']}))
    return 0
