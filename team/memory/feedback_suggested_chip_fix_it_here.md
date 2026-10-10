---
name: feedback_suggested_chip_fix_it_here
description: When Caleb asks about a "Suggested task" chip another tab raised, verify the bug and fix it in the current tab; never tell him to click the chip.
metadata:
  type: feedback
---

A "Suggested task" chip is a spawn_task card another tab raised for an out-of-scope bug. On 2026-10-09 he sent a screenshot of one (heavy jobs starved behind a paused transcription) with "Uh". I checked the queue, confirmed it was real, and told him the chip was worth clicking. His reply: "Do it here?" The fix took one tab and twenty minutes (f7619def, heavy jobs take 15-minute turns).

**Why:** clicking spawns yet another tab on a Mac already running a dozen, and handing him a button to press is the same failure as handing him a command. See [[feedback_never_hand_him_a_command]] and [[feedback_dont_report_what_you_can_fix]].

**How to apply:** when he asks what a chip is, check the claim against the real system in one or two calls, then fix it in this tab, test, push, and say it's handled so he can ignore the chip. Only point at the chip if the fix would collide with a file another live tab is editing.
