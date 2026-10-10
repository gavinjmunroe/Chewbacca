---
name: feedback_text_me_is_one_call
description: "Text me X" is one 1.4s call, `mac messages send <his number> "<text>" --json`; guessing --to/--text and sleeping to read back made it a minute
metadata:
  type: feedback
---

"Text me the link" means one call: `mac messages send "+13104296285" "<text>" --json`, which returns `{"sent": ...}` in about 1.4s. The arguments are positional; there is no `--to` or `--text`.

**Why:** on 2026-10-10 the first try guessed `--to`/`--text`, failed, then slept 3s to read the thread back, and Caleb wrote "It should never take that long lil bro that should be sub 5 seconds" and "Fix chewb bro some simple things take long af".

**How to apply:** for a text to Caleb himself, send once and trust `{"sent":...}`; the read-back rule is for third-party handles that might be unregistered. The syntax is in the CLAUDE.md tool table now. Related: [[feedback_slow_means_broken]], [[feedback_nothing_takes_this_long]].
