# Scheduled agents

Amber has two kinds of agents running on a schedule, every day,
whether you asked them to or not.

## Product track

Agents that touch Caleb and Sagar as users. They speak in Amber's
voice. They never reveal AI-ness. They always write evidence to
`vision/outbox/` or `vision/inbox/` so the team can audit later.

| Cadence | What it does | How |
|---|---|---|
| Daily 10:30 AM EDT | Morning emotional check-in to Caleb | `send-checkin.js --to caleb --dimension emotional --kind morning` |
| Daily 12:30 AM EDT | Evening physical check-in to Caleb | `send-checkin.js --to caleb --dimension physical --kind evening` |
| Weekly Sunday 1:00 PM EDT | Sunday spiritual reflection for Caleb | `send-checkin.js --to caleb --dimension spiritual --kind sunday` |
| Daily 10:30 AM EDT | Morning emotional check-in to Sagar (Phase 0, inbox-only until phone is wired) | `send-checkin.js --to sagar --dimension emotional --kind morning` |
| Daily 12:30 AM EDT | Evening physical check-in to Sagar (Phase 0) | `send-checkin.js --to sagar --dimension physical --kind evening` |
| Weekly Sunday 1:00 PM EDT | Sunday spiritual reflection for Sagar (Phase 0) | `send-checkin.js --to sagar --dimension spiritual --kind sunday` |
| Daily 12:00 PM EDT | Vision synthesis over the day's inbox | `node scripts/vision-synthesis.js` then opens a draft PR |

Product-track agents are **forbidden** from:
- Hand-rolling Loop POSTs. The only send path is
  [`Newton/agent/scripts/send-checkin.js`](../Newton/agent/scripts/send-checkin.js).
- Claiming success without writing an outbox record. An outbox record
  at `vision/outbox/<YYYY-MM-DD>/<message_id>.json` is the only
  acceptable proof of delivery.
- Editing anything under `Tiwari/tiwari-training/` or the training
  pipeline.
- Sending the same prompt two days in a row (Caleb's morning) or two
  Sundays in a row (Caleb's weekly). Vary phrasing.

## Build track

Agents that improve the product without bothering anyone.

| Cadence | Primitive | Track | What it does |
|---|---|---|---|
| Nightly | peoplerank | sagar-mirror | Personal graph training over Sagar's contacts |
| Nightly | opportunity | sagar-mirror | Channel-gate / billing training |
| Nightly | enrich | sagar-mirror | Healthcare enrichment training |
| Nightly | peoplerank | caleb-mirror | Visionary-base-case training |
| Nightly | opportunity | caleb-mirror | Same, opportunity primitive |
| Nightly | enrich | caleb-mirror | Same, enrich primitive |
| Weekly Sun | peoplerank | world | Opens a draft PR with hyperparameter deltas |
| Weekly Sun | opportunity | world | Opens a draft PR |
| Weekly Sun | enrich | world | Opens a draft PR |
| Daily 12:00 PM EDT | all three | Togari drift check | Compares vendored submodule SHAs to upstream HEAD |

See [`TRAINING-LOOPS.md`](TRAINING-LOOPS.md) for the training doctrine.

Build-track agents are **forbidden** from:
- Editing anything under `Newton/agent/agent.js` or the agent runtime.
- Sending any user-facing message. Training is silent.
- Merging world-level training PRs. They open drafts. A human merges.
- Depending on whether a check-in was answered. The training runs
  regardless - status `ok-no-signal` is expected on quiet days.

## Writing a new scheduled agent

1. **Decide the track.** Does it touch the user? Product. Does it
   train, sync, or watch? Build.
2. **Write a script in `Newton/agent/scripts/`.** Pure Node, no
   runtime `npm install`. See
   [`Newton/agent/scripts/README.md`](../Newton/agent/scripts/README.md).
3. **Choose a side-effect record.** Product writes to
   `vision/outbox/` and `vision/inbox/`. Build writes to
   `Tiwari/tiwari-training/runs/`.
4. **Exit codes are the contract.** `0` success, non-zero failure.
   The cron escalates via `send_notification` on non-zero.
5. **The cron body must be a hard specification.** Not a vibe. Steps
   numbered. Shell command literal. Verification explicit. See the
   three Caleb check-in crons for the template.
6. **Test by invoking the script manually first** with the full env
   loaded from `/home/user/workspace/amber/.secrets/loop.env` (or the
   equivalent for your primitive). Only after a manual invocation
   produces the expected outbox record should you register the cron.
7. **Trace afterwards.** Run
   `node Newton/agent/scripts/trace-checkins.js` (or the equivalent
   for your primitive) to confirm the cron is landing. An empty trace
   after a cron claimed success is always a cron-body bug.

## The goal

Caleb and Sagar each have constantly running scheduled agents serving
them as users, and a parallel set of scheduled agents improving the
primitives they depend on. Neither founder has to remember to run
anything. Neither founder has to wonder whether it worked. The outbox
is the proof. The tracer is the check.

This is the always-on posture. Everything else is a consequence.
