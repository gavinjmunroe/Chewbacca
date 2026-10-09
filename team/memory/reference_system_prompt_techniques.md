---
name: reference-system-prompt-techniques
description: Where the leaked-production-system-prompt findings live, and the two contradictions they opened that Caleb has not ruled on
metadata:
  type: reference
---

Compiled 2026-09-02 from whatstheprompt.net. The site itself is low signal
(800 cards, 580 from one upstream aggregator, half duplicates, jailbreaks
unlabeled). The value was four leaked production system prompts inside it:
Cluely general, Cluely `enterprise.md` live-meeting copilot, Claude 4 Opus,
Meta.ai / Llama 4, plus Google Assistant.

Eleven wiki pages under "Prompting and system prompts" in `wiki/index.md`.
Public write-up: `docs/SYSTEM-PROMPTS.md` in `calebnewtonusc/Chewbacca`.
Full corpus in `raw/processed/2026-09-02-whatstheprompt-*`.

The headline finding: production system prompts spend most of their length on
when NOT to act. Public prompt libraries are almost entirely "act as a senior
X," which is roughly 2% of what shipped.

**Two open contradictions needing Caleb:**

1. Is role assignment a top technique or near decoration? See
   [[Output format contracts do more work than persona assignment]].
2. Should an agent interview before acting? Six meta-prompts say yes; his own
   standing "never ask permission" rule says no. See
   [[Meta-prompts converge on interview first and draft second]].

**Non-obvious:** his `~/.claude/CLAUDE.md` already implements three lab
techniques independently. A banned-phrase list against slop (Meta bans "it's
worth noting," so does he), a priority override on the prayer rule, and format
contracts rather than persona. Four wiki pages point at that file, making it
the most-cited personal target in the wiki.

Related: a private note, [[feedback_no_confirmation_prompts]],
[[reference_writing_toolchain]].

## Update 2026-09-02, second layer: vendor primary sources

Five more wiki pages under "Evidence and practice, 2026" in `wiki/index.md`,
from Anthropic's platform docs and three papers. Raw extract:
`raw/processed/2026-09-02-prompting-practices-research.md`.

**The finding that changes how to write prompts for him:** on current models the
work is deleting instructions, not adding them. Remove verification and
double-check instructions (Opus 5 over-verifies), dial `CRITICAL: You MUST` back
to `Use this tool when`, drop thoroughness prompting. Prefill returns 400 from
Claude 4.6; `budget_tokens` returns 400 from 4.7. `effort` is the cost control.

**The persona contradiction moved.** The split now runs inside Anthropic: their
2026 blog lists role prompting under techniques less necessary now, their
platform docs still say "even a single sentence makes a difference." Same for
XML tags. Still unresolved, but no longer one aggregator versus two leaked
prompts.

**Measurement, the standing gap.** Built `skill-scan` (in Chewbacca
`bin/`, installed to `~/.local/bin`) to score skills with no model in the loop.
His stack: 69 skills, mean 68.4/100, 3 below 55. Still no agent eval has ever
been run: `~/.claude/commands/evals.md` is untouched and `skill-creator` now
ships an eval harness. Next real step.

Related: [[Evals come before prompt engineering, not after]],
[[Prompts accumulate corrections for failure modes that no longer exist]].
