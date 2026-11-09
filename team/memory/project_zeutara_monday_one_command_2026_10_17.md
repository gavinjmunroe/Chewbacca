---
name: project_zeutara_monday_one_command_2026_10_17
description: Zeutara's Monday launch is one command (zeutara-gtme scripts/monday_go.py, MONDAY.md), and Jonah answers every held reply with one @Togari line in Slack (Togari adb7082, 73607c8, 82a2144); built 2026-10-17 so Monday isn't brute-forced by hand
metadata:
  type: project
---

Caleb, 2026-10-17: Monday should be "take what Jonah says/does, a super streamlined process of implementing that... then we press the start button confidently", "not just brute forced if statement vibez", and "All aspects that can and should be LLM powered, make them LLM powered!"

The campaign side is `python3 scripts/monday_go.py --date <monday> [--jonah <file>] [--start]` in zeutara-gtme (b70f664, branch fix/verifier-substatus-uploads). It runs these steps in order:

1. A model sorts whatever Jonah said. Copy facts go to monday-<date>/jonah.md, holds go to holds.json, replies and handled items become @Togari lines, and anything else is printed as a question.
2. A model with no tools reads every draft as a fund partner. It blocks only on what would cost trust, and taste goes in notes. Chasing a grader's taste had rewritten step 3 into repeats of emails 1 and 2 that same day.
3. A blocked draft gets at most two model fixes, which `edit_problem()` has to pass before they touch Clay. Every fix that lands is logged in repairs.jsonl.
4. `gtme presend` runs with every flag, `--mx` included, then `gtme ready`. START happens only on READY, and a held draft is skipped.

The read and the presend receipt each expire after 12 hours, so the whole thing runs Monday morning. Its first live run on 2026-10-17 read all 8 drafts as clean and printed READY.

On the reply side, before this, Togari parked a reply for Jonah and tagged him, but nothing ever read his answer back. Worse, all five investors he owed sat in the older piles (four follow-ups at handoff_required, one reply at failed), which the new waiting list didn't cover at first. The fix is in the client assistant (src/agents/client-assistant):

- `waiting_on_you` lists every pile that needs a person. The system prompt gets only the count. The rows come back as a tool result, because investor text in a system prompt was a security finding.
- His one-line answer becomes a reply_to_investor card, now checked by draftProblem.
- A tap sends it and moves the follow-up to sent.
- `mark_handled` writes the same card-action "done" a card button writes, for anything he handled outside email.

The park post now tells him how to answer. Railway deploy 20207e45 runs 82a2144.
