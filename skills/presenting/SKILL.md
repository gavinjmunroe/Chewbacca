---
name: presenting
description: Build the thing he presents from, and protect it once the day arrives. Use for a talk, a presentation, a demo day, a pitch, a defense, a class presentation, or when a presenter window, speaker notes or a run-of-show is needed.
---

# Presenting

Written 2026-11-06, the afternoon of a BISC 101 presentation that went badly
for reasons that were entirely the tool's. Everything here is a rule that
would have changed that morning.

## The aid matches the rehearsal, not the request

This is the whole skill in one line, and getting it wrong is what happened.

A presenter aid has three levels:

| Level                | What it shows                                  | Who it is for                    |
| -------------------- | ---------------------------------------------- | -------------------------------- |
| **Script**           | the full sentence, verbatim                    | no rehearsal, learned it today   |
| **Sentence + spare** | the sentence for this beat, bullets underneath | one run-through, knows the shape |
| **Bullets**          | points only                                    | rehearsed, owns the connections  |

Pick the level from how much he has **rehearsed out loud**, never from what he
asks for. Turning a bullet into a sentence is real work, and it happens in
rehearsal. With no rehearsal that work lands live, in front of the room, while
he is also managing nerves and a clock, and the result is a list read aloud.

On 2026-11-06 he asked at 10:03, sitting in the room, for bullets instead of
the sentence: "I needa yap to fill the time". The sentence was moved behind a
disclosure at 10:13 and he presented minutes later. Afterwards: "Bro i ws j
reading the bullet points and it wasnt coherent at all the whole time". He was
right. The transcript reads as the bullet list with "so" glued between the
items.

**When he asks for a lower level than his rehearsal supports, give him both
and say which to lean on.** Never take the sentence away. Put it one tap away
at most, and say so in the reply.

## Nothing ships once the day starts

`live-event-guard.sh` refuses deploys, pushes and publishes from 30 minutes
before a graded live event until 2 hours after, reading `coursework today
--json` for an entry of type presentation, exam, quiz, interview or defense.
`tests/live_event_guard.sh` pins it, 15 assertions.

It exists because four changes were pushed to his presenter window between
9:59 and 10:14 while he waited to present at 10:00, the last one after he had
already started. The ledger had carried `type: presentation, at: 10:00` since
the night before and nothing read it.

During the window: write the fix down, tell him in chat what to tap right now,
ship afterwards. A tool in use is frozen. `LIVE_EVENT_OK='<reason>'` overrides
it and should be rare enough to feel wrong.

## What a presenter window actually needs

In priority order, from what he reached for and what he could not find:

1. **What is on screen right now.** He is narrating a drawing he is not
   looking at. Without this he cannot tell whether his words match the picture
   behind him.
2. **The line for this beat**, at the level the rehearsal supports.
3. **What the next click does.** Removes the small panic before every advance.
4. **Spare material**, three or four facts he can expand into sentences if he
   is running short.
5. **A clock he starts himself**, with pause and restart. Never one that
   starts on its own: the order of speakers is usually unknown, so a
   self-starting clock reads "491s ahead, slow down" before he has said a word.
6. **Question prompts on the last stop**, one line each, read in the two
   seconds after someone asks.

Everything else is one tap away, collapsed. A paragraph visible while he talks
is a wall, and he will say so.

## Build it the day before, freeze it the night before

The deadline for the presenting tool is the night before, not the morning of.
A tool he sees for the first time at 9:45 is a tool he has to learn while
presenting.

If the day arrives and the aid is wrong, the fix is a sentence in chat telling
him what to tap. Not a deploy.

## Rehearsal is the deliverable, not the tool

A beautiful presenter window and zero run-throughs loses to index cards and
three run-throughs, every time. When the schedule is tight, cut tool work and
protect rehearsal time. Say it plainly:

> The tool is good enough. The thing that moves the grade now is saying it out
> loud twice.

The rubric agrees. USC's BISC presentation rubric spends 4 of 20 on
"explains ideas in their own words", 2 on "speaks clearly, at an appropriate
pace", and 1 on "appears prepared/rehearsed". Seven points ride on rehearsal
and none on the aid.

## Checks before he walks out

- The aid level matches the rehearsal, and the sentence is still reachable
- Nothing has shipped since the night before
- The clock starts on his click
- Read it at phone width and at laptop width, as the person holding it
- Name pronunciations in the script where they are not obvious: Frangoul,
  Nishimasu, Lyfgenia, Casgevy. Five slips came from exactly this on 2026-11-06
