---
name: feedback_argv_reaches_string_flags
description: people CLI parseArgs turns any --word into a flag, so internal state on a string key is settable from argv; use Symbol keys, and freeze approved bytes at check time
metadata:
  type: feedback
---

`bin/lib/people/output.js` parseArgs makes every `--word` a flag. On 2026-10-31 the first cut of `people send --file` marked an already-approved inner send with `flags.approved`, which meant `people send x "hi" --approved` would have skipped the send press. Review caught it before landing.

**Why:** anything a send path reads off `flags` is user input. Same day, the automated security review found the attachment was hashed at check time but re-read at send time, so a swapped file could go out under an approval for different bytes.

**How to apply:** internal flags go under Symbol keys (send.js FILE and APPROVED), and tests/people_send.sh fails if send.js reads `flags.approved` or `flags.fileInfo`. Anything a press approves (a file, a payload) is snapshotted once and only the snapshot is sent; attach.js freezes it in a 0700 temp dir and rehashes the staged copy. Related: [[feedback_never_live_test_a_send]].
