"""The Codex start briefing fits under the host limit by naming files, never by losing rules.

On 2026-10-16 the briefing was 41,986 tokens; Codex keeps about 32k and cut the
middle, which held the git, security and writing rules (the em dash ban).
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import agent_context as context  # noqa: E402


class BriefingBudget(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.brain = root / 'brain'
        for name, size in (('core/identity.md', 2000), ('core/now.md', 40000), ('core/people.md', 50000),
                           ('core/voice.md', 9000), ('memory/MEMORY.md', 60000)):
            path = self.brain / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f'# {name}\n' + 'x' * size)
        claude = root / 'claude'
        (claude / 'rules').mkdir(parents=True)
        (claude / 'rules' / 'writing.md').write_text('# Writing Rules\nEM DASHES ARE BANNED\n' + 'w' * 20000)
        (claude / 'rules' / 'typescript.md').write_text('# TypeScript Rules\n' + 't' * 4000)
        (claude / 'CLAUDE.md').write_text('# Global\nPRAY FIRST\n')
        patcher = patch.object(context, 'claude_home', return_value=claude)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_over_budget_names_the_index_and_people_first_and_keeps_every_rule(self):
        text = context.startup_briefing(self.brain, budget_chars=90000)
        self.assertLessEqual(len(text), 90000)
        self.assertIn('EM DASHES ARE BANNED', text)
        self.assertIn('PRAY FIRST', text)
        self.assertIn('# core/voice.md', text, 'voice is never swapped for a pointer')
        self.assertNotIn('# memory/MEMORY.md', text)
        self.assertIn(f"Read {self.brain / 'memory/MEMORY.md'}", text)

    def test_under_budget_inlines_everything(self):
        text = context.startup_briefing(self.brain, budget_chars=10_000_000)
        self.assertNotIn('Not loaded at start', text)
        self.assertIn('# memory/MEMORY.md', text)
        self.assertIn('# TypeScript Rules', text)


if __name__ == '__main__':
    unittest.main()
