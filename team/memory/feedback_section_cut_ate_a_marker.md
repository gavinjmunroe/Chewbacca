---
name: feedback_section_cut_ate_a_marker
description: Cutting sections out of ~/.claude/CLAUDE.md by heading deleted a managed marker line, and setup then refused to touch the file; also padded markdown tables doubled people.md's token cost
metadata:
  type: feedback
---

On 2026-10-08 a context trim removed "Debugging protocol" up to "## Shared personal context" in the global CLAUDE.md. The `<!-- CHEWBACCA SHARED CONTEXT BEGIN -->` line sat just above that heading, so it went too. `agent_runtime.py setup` then failed with "ambiguous startup markers" until the line was restored from the backup.

The same session found core/people.md at 25,500 characters, about half of it spaces: prettier pads every markdown table cell to the widest row. Converting the two tables to `-` lists cut it to 12,600 with no fact lost.

**Why:** generated files carry `<!-- ... BEGIN/END -->` markers that tools find by exact match, and a section cut by heading can't see them. Table padding is invisible in an editor and is billed every session.

**How to apply:** before cutting a span of a generated or merged file, grep the span for `<!--` and keep any marker; take a backup and diff afterward. Write always-loaded brain files as lists, never tables. Related: [[feedback_verify_the_generated_block]], [[feedback_fix_the_product_not_your_machine]].
