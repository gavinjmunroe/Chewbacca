---
name: pasted-call
description: "Turn a pasted call transcript into every commitment, checked against the texts after it and grouped by when. Use when a Granola or Otter transcript is pasted, or for 'add all that' or 'what came out of that call'."
triggers: >-
  A meeting or call transcript pasted into chat (Granola "Meeting Title / Transcript / Them: / Me:" shape, Otter, Zoom), or "add all that to the todo", "what do I owe from that call", "what came out of the call with X".
---

# Pasted call

A pasted call means two things at once: remember it, and track what's owed.
Both fail the same way, by reading the transcript alone and stopping there.

## Never

- Never skim. Read every line, including the chatter around the plan. On
  2026-10-25 a Dad call had football, a haircut story and his sister's college
  app wrapped around the real asks, and the first pass went straight to the
  ledger. Caleb: "DONT SKIM".
- Never ledger from the transcript alone. The call ended, then texts kept
  going. On 2026-10-26 the first pass logged "church w Langston the weekend
  after next" when the texts showed Caleb had invited him to a San Diego
  retreat that weekend, and logged "call Gavin" as done-ish when Gavin had
  texted "Can't call" and moved it to 2pm the next day. Caleb: "I hv a feeling
  you skimmed bro and didn't organize things well in an actionable way".
- Never answer a pasted call without loading this skill. On 2026-10-29 a
  Roy Scott call was ledgered with no texts read and a son's name wrong,
  three skims in five days. `.claude/hooks/pasted-call-gate.sh` now hands
  this method over at prompt time and refuses the Stop when the skill,
  `people texts`, the ledger or the brain save is missing.
- Never hand back a flat list. A dozen rows in call order is a pile, not a plan.

- Never treat a transcript that stops mid-sentence as the whole call. On
  2026-10-30 the first OPTRA paste ended at "So then all you have to do is
  just take the meeting." The ledger said the ask never happened, then the
  full paste showed a free 50 row test offer, a price counter and 40 more
  minutes. If the last line is mid-thought or the meeting ran longer than the
  text covers, say "this looks partial" first and write nothing that depends
  on the ending.

## Do

1. Read the whole transcript once for who's who. "Them" is often several
   people or a TV in the background. Drop the noise, keep every line that has
   a person, a promise, a date or a product idea.
2. For each person on the call and each person named in it, read the texts
   since the call: `people texts "<full name>" --limit 30`. A first name or a
   word like "Dad" can resolve to the wrong person, so use the full name.
   Look for: a time that moved, a link already sent, a reply still owed,
   something they asked outside the call.
3. List every item: what Caleb promised, what someone promised him, what he
   is waiting on, decisions and preferences someone stated (keep their
   framing, e.g. "after the meeting, not real time"), product ideas with the
   real story behind them, and personal habits someone told him to keep.
4. Group by when, then hand it over in that shape:
   - Today
   - This week
   - Waiting on (who, since when, when to nudge)
   - Agenda for the next call with the collaborator it belongs to, when the
     items are product ideas
   - Habit
5. `work-ledger add --scope ~ --source-key <call>-<slug>` for each, with a
   next action that says the concrete step and the evidence (a time, a link
   already sent). Fix or cancel rows the texts disproved, with a reason.
6. Save the call to the brain with the argument or story intact, so a reply
   drafted later has its source. Personal and family detail stays out of
   anything shared.

7. "Tell the other tabs" after a call means `ListAgents`, then one
   `SendMessage` per live session carrying only what touches its work (a
   site tab gets the page change, a GTM tab gets the client facts), plus
   a team/memory note they can all read. Business facts only: no health,
   no unofficial role changes. A task he hands to a tab goes to that tab,
   not done here (Roy call, 2026-10-29: "Add Roy to the FF site btw tell
   the other tab that's doin it").

## Check before handing over

Read each row as Caleb at 8am: does it say what to do, and is it still true
after the texts? A row that would surprise him is wrong.
