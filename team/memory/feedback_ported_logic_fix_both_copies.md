---
name: feedback_ported_logic_fix_both_copies
description: Reply classification lives in two copies (togari-platform reply-intent.ts and Chewbacca tools/gtme_reply.py); a fix to either lands in both the same hour, with the same test.
metadata:
  type: feedback
---

Chewbacca's `gtme-reply` is a port of togari-platform's `replyIntent`, kept in parity by a 36-input check. On 2026-10-10 the bounce fix went into Chewbacca first, then upstream (togari #77). A security review then caught that both copies checked BOUNCE before UNSUBSCRIBE, so "remove me, my mailbox is full of these" would be filed as a bounce and never blocklisted. That's an opt-out silently dropped, which is a compliance failure. It was fixed in togari #78 and Chewbacca 1466333c, each with the same two test sentences.

**Why:** a fix that lands in one copy leaves the other one live with the bug, and the parity check only covers the inputs it already has.

**How to apply:** when you change a classifier branch in either file, grep the other for the same regex name and change it in the same hour. Add the same test sentence to both test files. Opt-outs always go first in the order, ahead of anything looser. Related: [[feedback_client_agents_propose_never_act]], [[feedback_ported_knowledge_must_stand_alone]].

Since 2026-10-13 the next-step copy has a mechanical guard too: `reply-copy-cases.json` sits byte for byte in togari (`src/agents/smartlead-responder/__tests__/`) and Chewbacca (`tests/fixtures/gtme-reply/`), each suite runs every case for three clients (Zeutara, a fixture client, none) and pins the file's sha256. Change a string in one copy and that suite fails until the corpus, and therefore the other copy's test, changes with it. The copy reads the client's facts (togari `replyCopy`, Chewbacca `voice.first_name` plus `offer_facts`); the kind a reply gets never reads the client.
