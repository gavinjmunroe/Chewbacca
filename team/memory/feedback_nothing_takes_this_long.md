---
name: feedback-nothing-takes-this-long
description: 'Caleb, 2026-10-03, mid machine reorg: "nothing you do should ever take this long". Ship in minutes, report, stop.'
metadata:
  node_type: memory
  type: feedback
  originSessionId: 07e2250f-d068-4a09-9f72-08664b98dc20
  modified: 2026-10-04T02:37:58.199Z
---

During the 2026-10-03 move to `~/code` (a private note) the turn ran well past an hour: a 348-repo inventory, a 469s full test suite, then a second pytest run to chase failures unrelated to the change. He interrupted with "Hey nothing you do should ever take this long".

**Why:** he watches the session live. Long stretches read as stuck, and chasing failures that predate the change is time he didn't ask to spend.

**How to apply:** run only the touched tests, never the full suite inside a big turn unless asked. Report old failures in one line instead of investigating them. Rewrite the config every tool call depends on (hook paths) before moving what it points at. Related: [[feedback_chewbacca_full_suite_is_slow]]

2026-10-08: "You taking too long bruh" came twice in one build, once during a full test suite and once while a code review ran in the foreground. Run reviews and suites in the background, keep building on independent pieces, and send a one-line status before any wait over a minute.
