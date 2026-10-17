#!/usr/bin/env python3
"""Every bin/ tool a skill or rule tells agents to run by bare name gets linked
onto PATH by setup.sh.

The backlog 26 audit (2026-10-16) found eleven: docs said `gtm clients`,
`decision-inbox check`, `reel-check`, `qr --from` and so on, every one a real
script in bin/, none of them in setup's link lists, so an agent following the
doc got "command not found" on a fresh install and on this Mac.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import tools_link  # the same parser the kit runtime uses to put tools on PATH
linked = set(tools_link.names_from_setup((ROOT / 'setup.sh').read_text()))

docs = [ROOT / 'CLAUDE.md', ROOT / 'AGENTS.md']
docs += sorted((ROOT / 'config' / 'instructions').glob('*.md'))
docs += sorted((ROOT / '.claude' / 'rules').glob('*.md'))
docs += sorted((ROOT / 'skills').glob('*/SKILL.md'))

missing = {}
for doc in docs:
    for span in re.findall(r'`([^`\n]+)`', doc.read_text(errors='replace')):
        word = span.strip().split(' ', 1)[0]
        if ' ' not in span.strip() or not re.fullmatch(r'[a-z][\w-]+', word):
            continue
        if (ROOT / 'bin' / word).is_file() and word not in linked:
            missing.setdefault(word, set()).add(str(doc.relative_to(ROOT)))

for word, where in sorted(missing.items()):
    print(f'not linked by setup.sh: {word}  (named in {", ".join(sorted(where))})')
print('ok' if not missing else f'{len(missing)} tool(s) a doc names that setup never puts on PATH')
sys.exit(1 if missing else 0)
