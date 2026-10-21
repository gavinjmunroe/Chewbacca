# Amber check-in product spec

> This is a **product** spec, not a training spec. See
> `docs/TRAINING-LOOPS.md` for the training track. The two tracks are
> intentionally separate: training runs regardless of whether anyone
> answers a check-in.

## What it is

Amber texts the user on iMessage, daily, with one dimension-scoped
question. The user replies — by text, by voice memo (Loop delivers both
identically to the inbox), by image, or not at all. Replies land on
`/ingest/checkin` (pipe trust = 1.00) and are stored on the user's
amber-id with the intended dimension stamped.

## Cadence (Sagar, base case)

| When | Dimension | Prompt character |
|---|---|---|
| 07:30 PT weekdays + weekends | **emotional** | How do you feel? What did you dream? |
| 21:30 PT weekdays + weekends | **physical** | Who did you meet IRL? What did you do? What environments? |
| 10:00 PT Sundays | **spiritual** | Weekly reflection |

Other dimensions (intellectual, social, financial) are Perplexity's
hemisphere and are covered by Amber only when the user volunteers a
thought. Amber does not ask about them.

## Transport — Loop Message

Deploy phases:

1. **Phase 0 (today)** — Loop already has Caleb's number wired up.
   The check-in crons send Caleb's version of the prompt to Caleb.
   Sagar's version is staged in `vision/inbox/` for now.
2. **Phase 1 (in ~2 days)** — Sagar's Loop number lands. Add
   `SAGAR_PHONE_NUMBER` env var; cron fans out to both.
3. **Phase 2** — partner with Loop to generalize: every Amber cNFT mint
   provisions its own Loop number. Cron looks up each user's Loop number
   from `device_bindings` in amber-id and sends accordingly.

Bootstrap rule: when only one phone is wired, only that phone gets the
texts. The other user's prompts are written to `vision/inbox/` and
picked up by their future Loop number retroactively (the ingest record
carries the intended `to_cnft`, so it replays cleanly).

## Prompt style

- **Warm, single question.** Never a multi-part prompt.
- **No "AI"-ness.** See Newton/agent/agent.js system prompt. Amber never
  reveals it is an AI.
- **Voice-memo friendly.** The prompt should be askable such that a
  30-second voice memo is a complete answer. No structured input.
- **Context-aware.** The cron reads the last 2 days of check-ins from
  amber-id before composing the prompt — so Amber never asks "how did
  you feel?" three mornings in a row with the same phrasing.

## Example prompts

Morning (emotional):
- "morning sagar. how are you waking up today — any dreams sticking?"
- "before the day starts, where's your chest at. heavy, open, flat?"
- "what feeling followed you out of sleep this morning?"

Evening (physical):
- "who did you sit with today and where was it?"
- "what did your body actually do today — and whose body was near it?"
- "three places today. who was in each one?"

Sunday (spiritual):
- "it's sunday. where did you feel most you this week — and with whom?"
- "what prayer or quiet moment from this week do you want to keep?"

## Receiving the reply

1. Loop webhook → amber-agent (existing path).
2. Agent classifier routes the incoming message: if `replyToId` matches
   a recent check-in, stamp it as `pipe: checkin` with the dimension of
   the prompt.
3. If it's a voice memo, Loop already delivers a transcript in its
   payload; we store both the audio attachment URL and the transcript.
4. Ingest into Pinecone via amber-id `/ingest/checkin`.

## What the user gets back

- **Nothing, by default.** Amber does not analyze the reply back at the
  user. It just acknowledges: a warm one-liner, tapback, or a gentle
  "thanks, heard you."
- **Weekly synthesis (Sunday 11:00 PT)** — Amber sends a short summary
  of the week's check-ins grouped by dimension. Not a dashboard; a
  letter.
- **On-demand** — user can text "what do you remember about me this
  week" and get a short people-first digest.

This is deliberately sparse. The product track is about Sagar talking to
Amber, not Amber talking to Sagar. Amber's only proactive voice is the
three check-ins + the Sunday letter.

## Out of scope here

- Training — see `docs/TRAINING-LOOPS.md`.
- Medical advice — forbidden without clinical sign-off. See space
  instructions.
- Group check-ins, household check-ins, partner check-ins — later.

## Safety

- **Quiet hours.** If the user has snoozed, don't send.
- **Rate limit.** Three check-ins + one Sunday letter. No other
  proactive sends without explicit intent.
- **Opt-out.** Reply "stop" or "pause" suppresses further check-ins
  until explicit resume. Stored on amber-id per-user.
