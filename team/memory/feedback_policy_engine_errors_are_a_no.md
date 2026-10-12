---
name: feedback_policy_engine_errors_are_a_no
description: Cedar skips a forbid whose condition errors, so a send policy reader must deny on any error and validate strictly; a policy mirror needs a parity test against the code it mirrors
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

**How to apply:** any rule engine behind a send or guard: deny on error,
validate strictly, and test parity with the inline code on odd inputs. A
binary lookup never uses a PATH search (tests stub shutil.which for fake
`mac`, and the lookup found the stub). Links: [[project_chewbacca]].
