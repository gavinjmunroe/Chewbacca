---
name: feedback_caleb_steering_2026_10_16
description: Caleb's steering rate is measured by tools/steering_rate.py; 2026-10-16 baseline 2.59 steering messages per active agent hour, with three Stop hooks shipped against the top causes (stopping early, handing him a click, not saving lessons)
metadata:
  type: feedback
---

Steering means a message Caleb had to type to correct or push an agent: a push to keep going, a rule he had to state, a complaint about slop, a claim he caught, a click he got handed. `tools/steering_rate.py` counts it per day from every Claude Code transcript and Codex rollout, keeping only words he typed (hook injections, other tabs' messages and programmatic prompts are dropped).

At 4:47pm on 2026-10-16 he wrote "I should not have to be as involved as I have been especially with directing chewb to be intelligent and handle a task process." That day's count, to 4:48pm:

- 183 messages he typed into 30 sessions, over 38.3 active agent hours (gaps between rows capped at 10 minutes)
- **99 steering, 2.59 per active agent hour, 3.3 per session**, plus 19 status polls ("We good?")
- 10/15 under the same patterns: 32 steering, 1.0 per hour. The patterns were written from 10/16, so 10/15 is undercounted.

## Clusters, ranked by count times cost

Cost is the minutes of his attention one occurrence takes, guessed, never measured.

| Cluster                     | Count | Cost | Score | What the agent should have done unasked                 | Real quote                                                                                                                                            |
| --------------------------- | ----- | ---- | ----- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| stopped_early               | 22    | 5    | 110   | Done the leftover its own recap named                   | "Are you done with your work? There's noting more you could do?" (3 tabs, 14:47 to 14:49)                                                             |
| missed_capability           | 9     | 10   | 90    | Tried the kit's other routes before handing him a click | "BRO U HV JEV BROWSER AGENT", "Why can't you do it?", "I thought we had reverse engineered clay wtf?" (minutes before the Sabo demo)                  |
| quality_slop                | 14    | 4    | 56    | Read its draft as the reader would                      | "Bro that's so ai slop", "This is too much text bro wtf"                                                                                              |
| unchecked_claim             | 7     | 5    | 35    | Checked its own number or claim                         | "Wait is 1% actually the bar where did u get that", "Was my pitch even accurate tho"                                                                  |
| learn_ritual                | 26    | 1    | 26    | Saved its lessons when the work landed                  | "Peace bro, learn and remember everything you should" (9 tabs, 16:06 to 16:10)                                                                        |
| permission_ask              | 10    | 2    | 20    | Run inside the standing allowance                       | "I approve live Clay runs for Gymshark, Celsius and Barebells"                                                                                        |
| not_reusable                | 4     | 5    | 20    | Built it repeatable and server-side from the start      | "Make sure everythign we do for sabo is repeatable and productizable!", "we should never hv anythign dependent on our computer being open on a loop!" |
| polls                       | 19    | 1    | 19    | Said where it stood                                     | "We good?" (9 tabs, 16:40 to 16:42)                                                                                                                   |
| not_managing                | 2     | 8    | 16    | Driven the other tabs instead of waiting                | "You haven't been managing them."                                                                                                                     |
| be_smarter, silent_progress | 5     | 3    | 15    |                                                         | "15 mins doing what bro wtf?"                                                                                                                         |

## What shipped (defaults, not reminders)

All three are Stop hooks registered by setup.sh, each with a test built from that day's real replies, and each refuses once (stop_hook_active lets the next stop through).

- `open-work-guard.sh` (stopped_early). Reads the last reply plus the turn's wrap_up recap and ask. Names its own leftover ("haven't gone out", "aren't built", "still open") or offers it as "Want the ...?" with no BLOCKED: line, and the turn can't end. Replayed on every turn he answered that day: it fires on 15, and 11 of those he followed with a push or a poll; 3 were offers he then took.
- `blocked-route-guard.sh` (missed_capability). A BLOCKED: that hands him a UI step must name two kit routes tried (chewbacca clay, jev-browse, browser pane, Claude in Chrome, peekaboo, computer use). Fires on both demo handoffs.
- `learn-on-land.sh` (learn_ritual). A turn that ran `chewbacca land` or `git push`, after code edits that came after the session's last lesson write, saves a lesson or says "No new lesson:". 14 of the 23 learn-and-remember asks matched this shape.

Not shipped here: quality_slop already has slop-guard; unchecked_claim has [[feedback_claims_match_the_mechanism]] and next_move.py from the same day; permission_ask was the "Stop chewbs asking before paid runs" tab's job. Those three are the next targets if the rate doesn't drop.

## The falsifier

    python3 tools/steering_rate.py --day 2026-10-17
    python3 tools/steering_rate.py --day 2026-10-17 --list    # read the labels before trusting them

The hooks worked only if stopped_early + missed_capability + learn_ritual, per active agent hour, falls below 10/16's 1.49 (57 in 38.3 hours) averaged over the next three days he works, and the overall rate falls below 2.59. If it doesn't, these were reminders in hook form: read the transcripts where the hooks fired and see what the agent did after the refusal. A pattern list misses new wordings, so a drop with a long `task` list may be the counter going blind, not him going quiet.
