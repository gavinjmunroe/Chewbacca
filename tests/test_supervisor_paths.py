"""Daemon services run the kit runtime, never the checkout setup ran from.

2026-10-11: the job queue's tick ran from ~/code/chewbacca while that shared
checkout sat 87 commits behind main under other tabs' edits, and three HUD
processes kept running from kit snapshots that had been pruned. The design
and migration order are docs/plans/one-supervisor.md; this pins step 2.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
setup = (ROOT / 'setup.sh').read_text()
bad = [line.strip() for line in setup.splitlines()
       if re.search(r'_daemon register\b', line) and '"$SCRIPT_DIR/bin/' in line]
if bad:
    print('FAIL a daemon service runs from the checkout, not the kit runtime:')
    for line in bad:
        print('   ', line)
    sys.exit(1)
if '_svc_root="$HOME/.chewbacca/kit/current"' not in setup:
    print('FAIL setup no longer points services at ~/.chewbacca/kit/current')
    sys.exit(1)
print('ok   every daemon service setup registers runs the kit runtime')
