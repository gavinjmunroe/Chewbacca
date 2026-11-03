---
name: feedback_formatter_hook_breaks_scripted_patch
description: The PostToolUse formatter rewrites a file right after Write, so a scripted str.replace written against the pre-format text silently matches nothing
type: feedback
---
The PostToolUse formatter hook reflows a file right after Write or Edit. A
Python `s.replace(old, new)` patch written against the text as typed then
matches nothing and exits 0.

What happened: on 2026-11-02, wiring Amber's people rules into Anchored, a
patch that added an `incoming` parameter to `askJev` silently didn't apply.
`tsc` passed, and only the Jev tests failing (0 calls made) showed it.

How to apply: patch with Edit after a Read, or assert the count in the
script (`assert old in s`) before writing it back.
