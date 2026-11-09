---
name: reference-injection-hold
description: "injection-hold: a pattern-flagged read or heard line holds a session's outbound actions until the person's next message, and what real transcripts say counts as that message"
metadata:
  node_type: memory
  type: reference
---

`injection-hold` holds every send, post, pay, delete and publish in a session after a flagged page, message or live-call line, until the person's next message. Rules, measured rate and limits are at the top of `bin/lib/injection_hold.py`.

What a later session needs:

- **Only patterns trip it.** Jev's flags stay warnings. To re-measure, `logs/untrusted-flags.tsv` now has a row per flag, because `verdicts.tsv` logs a warning as "allow". Keep Jev's scores out of this repo (TypeSafe agreement 2.3(f), see `bin/lib/screen.py`).
- **Claude Code says who typed.** A typed turn has `turnOrigin: human` and a `promptSource`. A notification is `task_notification`, another tab is `peer`, `claude -p` and a session's seed are `sdk`. A compaction summary also says `human` but has no `promptSource`, and tool results inherit the turn's origin, so both are excluded.
- **A message sent mid-turn isn't a user line.** It's a `queued_command` attachment, and it can sit after a read that's newer than what was typed, so clears compare time, not file position.
- **A changed field name fails toward holding.** If Claude Code renames these, nothing clears and every flagged session stays held, so check this first if a real message stops clearing.
- **The limit.** The agent runs as the same OS user, so a script file or computed path can still get past it. Real isolation needs a second OS user.
