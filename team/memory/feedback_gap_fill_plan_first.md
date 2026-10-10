---
name: feedback_gap_fill_plan_first
description: "Build what the other tabs aren't" gets the picked gaps in chat within a minute, then workers; silent survey drew "Wtf taking so long?" twice (2026-10-10)
metadata:
  type: feedback
---

When Caleb says "a bunch of tabs are running, build everything they're not building",
the first visible reply names the gaps picked and why they're unowned, before any
deep reading. On 2026-10-10 the survey (tabs list, work-ledger, backlog, a skill load
the gate demanded) ran four minutes with no text, and he sent "Wtf taking so long?"
twice before the plan appeared.

**Why:** with 10+ tabs live he can't tell a surveying tab from a stuck one; silence
reads as the stuck one. Same root as [[feedback_say_what_you_found_before_digging]].

**How to apply:**
- One pass: `tabs list` + `work-ledger list --scope <repo>` together, then pick
  ledger items with an empty or agent owner whose files no live tab lists.
- Reply with the picks in the same turn, then launch workers in worktrees.
- The session allows 2 concurrent subagents; queue the third and start it on the
  first completion notification instead of retrying the spawn.
- Claim each pick with `work-ledger update --id <id> --status active` (statuses are
  queued/active/blocked/done/cancelled) so the next gap-filler tab skips it.
- Writing "top 5" as a ranking metric trips scope-guard; say "first five results".
