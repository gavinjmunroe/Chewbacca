---
name: feedback_client_agents_propose_never_act
description: A client-facing agent that reads investor or customer text never acts straight from chat; it posts a card with the exact frozen plan and acts on one authorized tap
metadata:
  type: feedback
---

2026-10-10, building the Togari assistant Jonah talks to in Slack. Three rounds
of security review broke every gate that tried to decide from names whether
Jonah had "really" asked for an action: investors write the replies the model
reads and control their own display names, so name and email matching could
always be gamed (an "everyone" escape, a domain match, a last name like "what").

**Why:** the model reads untrusted text; anything it can do on its own, a reply
can make it do.

**How to apply:** the model only proposes. Resolve the action to a frozen plan
(the exact thread row, recipient, full email body, link), show all of it on a
card (refuse if it won't fit, never truncate), and run that plan, not a fresh
lookup, on one tap by an approver from that card, claimed atomically. Togari
PRs #72-76. See [[feedback_client_cards_one_job]].
