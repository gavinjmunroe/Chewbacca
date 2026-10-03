---
name: call-coach
description: Debrief a sales or client call from its transcript or recording. Use when the user shares a call transcript, mentions a call that went well or badly, asks how they did, wants to prep for a follow-up, or asks what they missed. Also use on webinar, pitch and demo transcripts, and before a meeting to build a battle card on who is on the other side.
---

# call-coach

Reads a call and returns a debrief while the call is still fresh. The point
is the loop: feedback within minutes changes the next call, feedback in a
week changes nothing.

## Getting the transcript

Granola, Zoom, Fathom and Otter all export text. A recording on disk goes
through `whisper <file> --model small.en --language en --output_format txt`.
A Mac call with no recording is a dead end, so say that rather than guessing
at what was said.

## The debrief

Return these, in this order, and nothing else unless asked:

1. **What happened.** Five sentences, no more. What they want, what they
   objected to, what was agreed.
2. **Talk ratio.** Who spoke more, roughly, as a percentage. The buyer should
   be talking more than the seller. If the seller is over half, that is the
   headline finding and it goes first.
3. **Buying signals**, quoted. A signal is something they said, not a vibe.
4. **Key moments**, with the line that made each one matter.
5. **Missed opportunities.** The question that should have been asked, at the
   point it should have been asked.
6. **Score out of 10**, with the two things that cost the most points.
7. **Follow-up email**, in the user's voice, ready to send. Draft only.

## Scoring lenses

Score against negotiation and offer frameworks: calibrated questions,
labelling, tactical empathy, and whether the offer's value was made concrete
before price came up. Name which lens each deduction comes from so the user
can argue with it.

Swap the lenses for whichever practitioners the user actually trusts. Ask
once, then remember the answer in the second brain rather than asking again.

## Before the call, not after

Same skill, different direction. Given a name and a company, build a battle
card: who this person is, what they have built, how to open, which proof to
bring, and the five objections they will raise with a response to each.

**Two hard lines.** Never invent a case study. Never invent a client name.
An unverifiable specific goes in as `[NEED: ...]`, never as a plausible
value, because the one person who notices is the one who was there.

## What this is not

Not a verdict on the person. A bad call is usually a structural problem: no
discovery, price before value, or a question that never got asked. Name the
structure, not the character.

## During the call

`call-listen` puts one cue at the top of the screen each time the other side
finishes talking: ASK, SAY, HANDLE or CLOSE, at most a short line. Audio is
captured and transcribed on the Mac (`call-ears`, whisper); only the text goes
to the cue model.

- `call-watch` runs in the background and offers "Coach this call" when Zoom,
  Teams, FaceTime, Discord, Slack or a browser takes the mic. It stops the
  listener when the app lets go, and the transcript lands in `<brain>/calls/`.
- `call-listen --card <file>` reads a battle card on every cue. Without one it
  searches the whole brain for what was just said, plus `calls/COACH.md`, the
  standing list of offers, prices and proof that are true.
- Run the debrief above on the transcript it writes.
- Say an AI notetaker is running at the start. Some states, California among
  them, need everyone's consent to record, and transcription counts.
- Cues are prompts, not a script. Reading full sentences off the screen sounds
  like reading. Know the card; let the cue catch what you forgot.

## Feeding it back

When a debrief is right, keep the call. A corpus of the user's own calls that
closed beats any generic framework, and this skill gets better by reading
them rather than by being rewritten.
