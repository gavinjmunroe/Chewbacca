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

- Never leave a pasted transcript only in the session. In the same turn, save
  it whole to the project's folder in the brain, beside a RESUME.md with the
  doc link, where things stand and the next step, and add a ledger task that
  points at it. A session the user comes back to across days dies when the tab
  is archived. On 2026-11-06, after a planning talk for a party, Caleb wrote "I
  should NOT hv to give you that transcript or my answers again for context!
  THis is a given with chewbs". The save happened only after he said it.
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
- Never repeat a sales call's claims in the follow-up unchecked. Check each one
  against `dough/PITCH.md` and the public record, and walk back what doesn't
  hold. On 2026-11-05 a Fresh Fire call said "that email's cooked" and called 20
  a day a Google limit. Public DNS showed no SPF, which was the real finding, and
  nothing showed a blacklist. Read DNS over HTTPS: `dig` returned empty for every
  record from this Mac's shell that night, which would have read as no email set up.

- Never work a transcript another tab already has. When he says he pasted
  it in a different tab too, or `tabs context` shows another tab whose
  latest ask is the same transcript, write nothing (no Downloads file, no
  ledger row, no share) and reply that the other tab owns it. On 2026-10-31
  a Colin call went into two tabs, both started on the same "mega prompt"
  file in Downloads, one overwrote the other, and Caleb wrote "move all colin
  stuff to the other tab no reason to ahve 2".
- Never treat a transcript that stops mid-sentence as the whole call. On
  2026-10-30 the first OPTRA paste ended at "So then all you have to do is
  just take the meeting." The ledger said the ask never happened, then the
  full paste showed a free 50 row test offer, a price counter and 40 more
  minutes. If the last line is mid-thought or the meeting ran longer than the
  text covers, say "this looks partial" first and write nothing that depends
  on the ending.

- Never call a name unconfirmed off `people texts` alone. It matches one
  thread, and Contacts can hold the right person under an org suffix. Run
  `mac contacts find "<org>"` too. On 2026-11-05 a Gavin call's notes said the
  Circuit Riders singer's name was unconfirmed because `people texts "Josh
Brennan"` hit a startup guy. Contacts had "Josh Brennan Circuit Riders", and
  that thread showed Caleb had already texted him the site on 11/3.
- Never start from zero, or stop at the first pass, when the call was already
  saved. Grep the ledger for `<person>-call-<date>` and read the note first,
  then read the transcript against them and add only what's missing. On
  2026-11-05 a second read of a saved call found 6 missing rows, including
  tickets that depended on an unpaid invoice.

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

- Never trust the room capture's rows as they stand. A call the Mac recorded is
  already in the ledger as `meeting:rc-<stamp>:a<n>` and `reflect:rc-<stamp>:*`,
  with a model's read in `~/.chewbacca/meetings/reflections/rc-<stamp>.md`. Grep
  for those before adding anything, then check each against the transcript and
  texts. On 2026-11-05 a counselor call came in with "Call back Luke" (nobody
  owed a call, they run into each other at church), "Call back Diego" (tacos
  were already set by text for that night) and "Make something right" (no person
  named), while gym, tacos and a moved 9am meeting from the texts had no rows.

## A class lecture is a call too

A pasted lecture has one name on it (Caleb) and a professor talking to a
room. The people to read are the team, not the speaker. On 2026-11-03 an
ACAD 185 lecture came in and the first reply answered from the transcript
alone: the Kyber gc was quiet, but Angie's own thread said she'd take the
Hypothosheet and redo A20 with generated images, and an attendance code
Caleb asked for on Zoom was still unanswered.

- Find the team in the course file (`~/coursework/courses/<course>.yml`)
  and the project note in `~/second-brain/memory/`, then run `people texts`
  on the team gc and on each teammate by full name.
- Match what the prof assigned against the ledger rows for that course.
  An in-class deliverable due "by end of class" is a Today row even after
  class ends, until someone confirms it went in.
- Feedback on the team's work goes in the project note in full (what he
  praised, each change he asked for), because the next version is graded
  against it.
- Whisper garbles end-of-class chatter. A changed due date heard there is
  a note on the row, never a change to the ledger date.

## Check before handing over

Read each row as Caleb at 8am: does it say what to do, and is it still true
after the texts? A row that would surprise him is wrong.
