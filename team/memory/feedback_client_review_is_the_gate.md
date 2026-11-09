---
name: feedback_client_review_is_the_gate
description: "Zeutara 10-04: we called Monday's lists verified, Jonah's review found 5 unchecked defects and Sagar fixed them by hand. Read the client's feedback and make each item a refusal before saying ready."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 66c34f94-9afe-4074-979a-92171b0206f2
  modified: 2026-10-05T16:08:29.783Z
---

Zeutara is Jonah Graham's capital-raising firm (a private note). On 2026-10-04 Caleb's session declared Monday's four fit lists "pass the gate" (ZeroBounce, dupes, firm caps). Jonah's review then caught five things the gate never checked, and Sagar did the fixes himself: 97 sender inboxes on domains Jonah had ruled out (shop, pro, plus, now, io, help, faq, zone, net, home, daily, api, ai, plus graham@/grahamj@), 19 personalized lines claiming investments that never happened (Lead Edge/Bumble, Accel/CoinTracker, Khosla/New Club) and 13 rewritten, the Canaan and Arboretum CFOs, Sep 28 recipients getting a second first touch, and no firm-level auto-pause. Caleb asked on 2026-10-05 why Sagar had to do so much when we thought it was done.

**Why:** the lines came from the purchased file's portfolio columns and were never checked against a public source, and the final CSVs were `row_id,email,name,firm`, so any title or line check had nothing to read and passed by default. "Passes our gate" only meant "passes the checks we thought of."

**How to apply:** before calling a list or campaign ready, read Jonah's and Sagar's latest Slack feedback and make every item a check that can fail. Every "X backed Y" line needs a public source URL on the row. A check whose column is missing must refuse, not pass. All five are now refusals in zeutara-gtme `scripts/pre_send_gate.py` (commit 8e74dec, 44 tests), and the reusable half is in Chewbacca's list-audit skill (fbe4113). Related: [[feedback_a_silent_guard_proves_nothing]], [[feedback_enforce_dont_document]].

**Enforced 2026-10-05, not just written.** `launch-guard.sh` (PreToolUse, Chewbacca 5ae297e, 12 tests) refuses any Clay launch, resume or enroll through chewie, the clay CLI or peekaboo unless `pre_send_gate.py` wrote a FULL receipt in the last 12 hours. Proven live: a launch-shaped call was refused. Same day's second miss: an "Interested" category from `clay campaigns analytics` was reported as a lead and was Hustle Fund's apply-form redirect. `scripts/replies.py` in zeutara-gtme prints the reply text; never report interest from the category.

**Clay mistakes ledger, 2026-10-05.** Every Clay mistake on record, each paired with its guard, lives at the top of Chewbacca `skills/clay-navigation/SKILL.md` (3449dd2). `clay-reply-guard.sh` (PostToolUse) puts the read-the-text rule in front of the agent whenever analytics show a reply; proven live. New Clay mistake = new guard the same turn, then a ledger line.
