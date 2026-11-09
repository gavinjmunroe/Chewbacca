---
name: feedback_every_call_comes_with_a_take
description: A call handed to Caleb without the agent's take is refused by the decision inbox, flagged by `decision-inbox check` and the jobs runner, and lane prompts start from config/instructions/unattended-lane.md
metadata:
  type: feedback
---

Every decision an agent hands Caleb carries its take, one call per line:
`Ur call: <question>. My take: <what I'd do and why>.` On 10/13, 7 of the 11
calls agents handed him said "ur call" and stopped, so the inbox hid them and
he would have had to research each one himself.

**Why:** Caleb, 10/13 brief: "every decision you hand him comes WITH your
recommendation". A call with no take is research handed back to him.

**How to apply:**

- Start every overnight or daytime lane prompt from
  `config/instructions/unattended-lane.md` (`cat` it above the task).
- Before a lane ends: `decision-inbox check <report>` prints each call with no
  take as `file:line` and exits 1. The jobs runner prints the same list at the
  end of the job's `out.log`.
- The take goes on the line or the line under it; a heading call's take goes
  in its section. A BLOCKED click carries its how-to in brackets.
- A take written later by another agent is marked as theirs:
  `My take (<lane>, <date>): ...`. A ledger call's take goes in its next action.
- `Item` refuses a decision with no take: only `Draft.ready()` builds one, so
  no new source can draw an untaken call. See [[feedback_fix_the_class_at_the_source]].
