---
name: feedback_say_what_you_found_before_digging
description: When Caleb vents that a system is broken, measure in one command and tell him the diagnosis right away; three silent tool calls drew "???"
metadata:
  type: feedback
---

When Caleb reports a whole-system problem ("Chewb is a shit ton of scatterd mds the system is cooked", 2026-10-09), the reply he needs first is the diagnosis: what's actually wrong, with the number, and what's being done about it. That session ran three measuring commands and a skill load with no visible text, and his next message was "???".

The diagnosis also separated the real mess from the count. Of 1,042 md files, team/tasks and team/memory (one file per record) and apps/ux-engine (data) were most of them by design. The mess was 76 flat files in docs/ mixing guides, specs and one-off plans. That fix sorts docs/ into guide/, reference/ and plans/, behind a test that refuses a loose md in docs/.

**Why:** silence through tool calls reads to him as nothing happening, and a vent means he's already frustrated, so the cost of a quiet stretch is higher.

**How to apply:** one measuring command, then a short reply with the finding and the fix in flight. Put the long restructure in the background (a worktree agent when other tabs share the checkout), not in front of the reply. Related: [[feedback_never_narrate_the_plumbing]], [[feedback_nothing_takes_this_long]].
