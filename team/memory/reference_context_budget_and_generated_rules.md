---
name: reference_context_budget_and_generated_rules
description: The always-on context budget is 28k tokens, and ~/.claude/rules/agent-neutral.md is generated, so editing it directly gets reverted by setup.sh.
metadata:
  type: reference
---

Two things that cost a session on 2026-09-19.

## `~/.claude/rules/agent-neutral.md` is generated, not authored

The source is `chewbacca/instructions/agent-neutral.md`. `setup.sh` copies it
over the installed rule, `tools/agents_md.py` renders it into the repo's public
`AGENTS.md`, and `tests/test_codex.py` asserts the installed copy and the source
are byte identical. **Editing the installed rule directly is silently reverted
on the next setup run and breaks that test in the meantime.** Edit the source,
then `cp` it into place and run `python3 tools/agents_md.py`.

The same pattern holds for `AGENTS.md` and `SHA256SUMS.txt`: both are generated,
so resolve them by regenerating rather than by merging.

## The always-on context budget is 28,000 tokens

`python3 tools/context_cost.py` prints what loads before Caleb types a word, and
`doctor.sh` fails over budget. On 9/19 it was 30,121. What actually moved it:

- **`memory/MEMORY.md` was the cheapest win.** 41 pointers moved to
  `ARCHIVE.md`, 19 of which were rules already written out word for word in
  `CLAUDE.md`, so every session paid for them twice.
- **Skill descriptions are 6,500 tokens and nobody watches them.** `questions`
  alone was 1,387 characters because it enumerated all 17 sections inline when
  the skill body already has a richer routing table.
- Moving finished content out of `core/now.md` (a roles table that was 6 ended
  roles out of 8) and deduping `core/voice.md`.

**Two traps.** A YAML description containing `: ` must be quoted or the skill
silently stops parsing, which `tools/frontmatter.py` catches. And do not slice a
rule file between two headings without reading what is in between: doing that
deleted the whole "Private context and second brain" section, which carries
**do not assume a person's name** and **keep personal facts out of generated
exports**, and Chewbacca is a public repo.

See a private note and a private note.

## 2026-10-11: what the listing really costs, and the two new mechanisms

`bin/context-budget` reads what a session was actually sent, which beats
`tools/context_cost.py`'s file estimate. On 10/11 the first turn was 121,260
tokens; the full team MEMORY.md import was 11,636 of it, the largest single
file, and the skill listing 9,270. The listing held 392 entries but only 56
with a description: past its own cap Claude Code keeps the name and drops the
description, so a long description crowds other skills down to a bare name.

- Teammates import `~/.chewbacca/team-memory-index.md` (tools/team_index.py):
  every slug, every lesson line whole, project and reference lines by slug.
  kit-autopull rebuilds it each session. Add lines to the full index only.
- Kit skill descriptions stay at 220 chars or less (tools/frontmatter.py fails
  past it). The full routing text goes in a `triggers: >-` block, which
  skill_match and skill-route read instead, and Claude Code never loads.
- context_cost now counts enabled plugin skills and commands too.
