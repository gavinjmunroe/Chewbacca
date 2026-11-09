---
name: feedback_write_skills_unprompted
description: Chewbacca writes or updates its own skills the moment a lesson lands; Caleb should never have to ask for one.
metadata:
  node_type: memory
  type: feedback
  originSessionId: e837b0d5-277f-43aa-a181-40fe6dbba92b
  modified: 2026-10-09T08:40:37.721Z
---

Caleb, 2026-10-09, after a night of five corrections on the usctts.com rebuild:
"Write yourself skills!!!!!!!!!!!!!!", "Chewb should always write itself skills
when that is best", "I should never have to tell chewb to make a skill".

**Why:** he had corrected one website five times ("so lame", "abrupt",
"chopped", "low aura", "DO NOT USE THE AI GENERATED TEAM") and none of it had
landed anywhere a later session would read. kit-debt was supposed to catch
that, but it counted team-board auto-commits as learning and was advisory, so
it never fired.

**How to apply:** when a correction or a new working method lands, write it
into the skill that owns the work in the same turn (dated, in his words, as a
never-do), or into a gate when the failure is mechanical. Don't wait for the
end of the session and don't ask. It's enforced now: `bin/kit-debt` counts his
corrections in the session transcript, and the Stop hook refuses once when
there are two or more and the session wrote no skill, hook, rule or tool.

Related: [[feedback_never_close_without_updating_chewbacca]],
[[feedback_enforce_dont_document]], [[feedback_advisory_hooks_do_nothing]]
