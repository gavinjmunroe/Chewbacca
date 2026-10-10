---
name: feedback_run_ported_classifiers_on_real_inbox
description: Parity with the source code proves a port copied the bugs too; run it over a real inbox before calling it done. On 65 real Zeutara replies, both bounces came out "unclear" and would have reached the client (2026-10-10).
metadata:
  type: feedback
---

`gtme-reply` matched Togari's TypeScript on 753 of 757 parity outputs, which only proved it faithfully copied upstream. Running it over zeutara-gtme's `out/inbox/replies.json` (65 real replies, read locally, never committed) found that "Address not found" and "Message blocked" came out `unclear`, so they'd land in the client's channel as work. The reply guide already rules a bounce has nobody to answer. Chewbacca now has a `bounce` kind (auto-handled), documented as its one deliberate divergence, and the finding went to the Jonah tab for upstream.

**Why:** parity tests and the source's own fixtures share the source's blind spots. Real traffic is the only test set the author didn't choose.

**How to apply:**

- After porting or changing any classifier, run it over the real data it'll see and read every row that isn't auto-handled, plus a sample of the auto-handled ones. Keep the data local; commit only anonymized cases (see [[feedback_ported_knowledge_must_stand_alone]]).
- Don't override a decision the client team already made on real replies (the "may be interested... traveling 3 weeks" reply stays `later` per the 10/9 ruling); flag it to Caleb instead.

Related: [[feedback_seal_the_test_set]], [[feedback_client_rulings_first]].
