---
name: feedback_gtme_done_misses_togari_followups
description: "`gtme done` reading Done does not mean no investor is waiting: it never reads Togari's follow-up queue. On 2026-10-16 an agent said nobody was waiting, and the next morning Togari's digest listed 26"
metadata:
  type: feedback
---

`chewbacca gtme done` checks two things: Clay inbox replies whose kind needs an answer, and the client's unread Slack messages. Togari's daily digest (`src/replies/outcome-check.ts`) checks more: reply cards, and follow-up rows in `reply_followups` that sit at handoff_required, retry_exhausted or failed. On 2026-10-16 an agent saw `gtme done` print "Done: nobody is waiting on us" and passed that on to Caleb. On 10-17 Togari DM'd him "26 investors need follow-through", and he wrote "WHAT THE FUCK YOU SAID YOU FIXED IT".

Read thread by thread, 16 of the conversations had nothing owed: unsubscribes already suppressed, left-the-firm notices, auto-replies, and ones we had answered. They stayed listed because nobody had pressed Mark done, and because a handoff_required follow-up row was never cleared once a person closed the conversation (fixed in Togari 9719bb0). 8 were real: a yes to a founder meeting with no follow-up since, two forms, founder slots, a failed reply, NTM revenue, and a blank email.

**How to apply:** before saying no investor is waiting on a Togari client, run Togari's `findStuck` (zrec-ops/read-stuck.ts) and read each thread. Close what a person has settled with Togari's card action (`recordCardAction(..., "done", ..., true)`, zrec-ops/close-settled.ts), which covers only that inbound, so a new message reopens it. Say "gtme done is clean", never "nobody is waiting", until the digest is empty too.
