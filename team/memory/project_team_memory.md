---
name: project-team-memory
description: Where shared Amber, Chewbacca and Firm Foundation memory lives (team/memory, imported every session) and what stays private
metadata:
  type: project
---

Team memory is `team/memory/` in this repo, indexed one line per file in
`team/memory/MEMORY.md`. The runtime block that `chewbacca agent setup` writes into
`~/.claude/CLAUDE.md` imports that index, so every teammate's session loads it.
The rule lives in `config/instructions/agent-neutral.md` under "Team memory".

Built 2026-10-09 when Caleb said everything about Amber, Chewbacca and Firm
Foundation "should all be mutual in chewbs". 184 notes moved out of his private
brain. Another 49 on those topics stayed private because they held phone numbers,
pay or equity, health, or private reads on teammates. Links from shared notes to
private ones were replaced with "a private note", and key fragments and App Store
key IDs were redacted.

`tests/team_memory.sh` refuses an unindexed note, an index line with no file, and
key-shaped strings or personal emails. Medha's and Togari's public agent phone
numbers are allowed.

Related: [[feedback_everything_is_part_of_chewbacca]], [[feedback_subtree_import_merge_not_rebase]].
