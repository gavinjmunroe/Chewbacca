---
name: feedback_agents_send_by_default
description: Agents send texts and emails on their own; the step 12 press gate is opt-in, never the default (Caleb 10/12)
metadata:
  type: feedback
---

Reengineer step 12 (a44de8c9, 10/12 8:19am) made every kit send wait on a person's press. Caleb heard it described on his Amber call at 9:54am and said: "Wait wtf of course it should be able to send texts or emails???"

**Why:** the plan step came from a security lens, and it contradicted his standing rulings: "text me X" is one call (feedback_text_me_is_one_call, 10/10), a reply in a lead's own thread goes out with no confirmation step (Zeutara DECISIONS, 10/11), and no confirmation prompts anywhere (feedback_no_confirmation_prompts).

**How to apply:** `tools/send_approval.py` take() returns "agent" and logs a verdict row unless `~/.chewbacca/send-approvals/mode` says `press`. Never make a press, code or confirm the default on any send path. A plan step that adds a gate in front of his sends gets checked against his rulings before it runs. CHEWBACCA_NO_SEND and --dry-run still hold everything in tests.
