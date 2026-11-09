---
name: feedback_policy_engine_errors_are_a_no
description: Cedar skips a forbid whose condition errors, so the send policy reader answers no on any error and validates strictly; but a sink refuses only on a NAMED rule, so a broken reader never stops a send; a policy mirror needs a parity test on odd shapes
metadata:
  type: feedback
---

Cedar's authorizer skips any policy whose condition errors. For a forbid that
is a silent allow. crates/sendpolicy (reengineer step 13, 2026-10-12) denies
on any evaluation error and validates config/send-policy.cedar against its
schema on every call, so a misspelled field is a no, never a rule that quietly
stops firing. The strict validator also rejects `if !(context has x)`; write
`if context has x then ... else ...`.

The same night's review found the Python reader of quiet-hours.json disagreed
with people send's quietFor on a null day (32 of 480 quarter hours) even
though the week-long parity test passed, because the test only used Sagar's
rule shape. Parity tests run on the odd shapes too, not just the real one.

**Why:** a gate that fails open on a typo, or a mirror that drifts on an edge
the test never feeds it, both look green until a text goes out at 1am.

**But a broken reader never stops a send.** Caleb, 2026-10-12 9:54am, on a
gate in front of agent sends: "Wait wtf of course it should be able to send
texts or emails???" So the answer still says no on an error (`send-policy
could` reports it honestly), and every sink asks `send_policy.refuses()`,
which is true only when a rule is named. A no with no rule (a crash, a
timeout, a bad fact) is logged as policy-error and the sink's own inline
checks stand, the same as with no binary built (4a9748a4).

**How to apply:** any rule engine behind a send or guard: deny on error in
the engine, validate strictly, test parity with the inline code on odd
inputs, and let only a named rule refuse at the sink. See
[[feedback_agents_send_by_default]]. A
binary lookup never uses a PATH search (tests stub shutil.which for fake
`mac`, and the lookup found the stub). Links: [[project_chewbacca]].
