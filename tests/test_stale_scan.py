#!/usr/bin/env python3
"""tools/stale_scan.py flags what the backlog 26 audit found by hand (2026-10-16)."""
import json, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
d = Path(tempfile.mkdtemp())
(d / 'real.py').write_text('')
(d / 'x.md').write_text('See `tools/no_such_tool.py`, [ok](real.py) and [gone](missing.md).\n'
                        'Run `zz-no-such-cmd --json`, then `git status --short`.\n')
out = subprocess.run([sys.executable, str(ROOT / 'tools' / 'stale_scan.py'), str(d), 'x.md'],
                     capture_output=True, text=True, timeout=60).stdout
row = json.loads(out)
fails = []
if 'tools/no_such_tool.py' not in row['dead_paths']: fails.append('dead path missed')
if row['dead_links'] != ['missing.md']: fails.append(f"links: {row['dead_links']}")
if not any(c.startswith('zz-no-such-cmd') for c in row['dead_cmds']): fails.append('off-PATH command missed')
if any(c.startswith('git') for c in row['dead_cmds']): fails.append('git flagged')
print('\n'.join(fails) or 'ok')
sys.exit(1 if fails else 0)
