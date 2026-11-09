---
name: feedback_lowercasing_destroys_flag_case
description: "A hook that lowercases a shell command before pattern matching cannot tell curl -F from -f, which is the difference between an upload and a harmless flag."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 7bc76a22-b7a7-467f-ac73-87057b295045
  modified: 2026-09-22T06:10:08.771Z
---

Chewbacca's `submit-guard.sh` lowercased the whole command, then matched
`* -f *` to catch curl's form upload. **On 2026-09-21 that hard-blocked a GET
downloading lecture slides**, because the command opened with
`[ -f ~/Downloads/PoD/x.pdf ] || curl ...`. Nothing was being submitted.

**Why:** `-F` (form, a real submission), `-f` (`--fail`, harmless) and the shell
test `[ -f path ]` all collapse to the same string once you lowercase. The
normalization that makes matching easy is the same normalization that throws
away the signal.

**How to apply:** normalize for the coarse question and match the original text
for the precise one. `submit-guard.sh` now keeps `$lower` for "is this an LMS at
all" and matches `$blob` for `*curl* -F *`, `-T` and `--upload-file`. Flags,
paths, env var names and base64 are all case-bearing. Never lowercase them and
then decide something irreversible.

**Two things this run got right and should keep doing.** The guard's message
said _do not route around this_, so the fix was to the matcher, not a bypass.
And the new regression cases were run against a rebuilt copy of the pre-fix
hook first: both reproduced the block, which is what makes them real rather
than decoration. See [[feedback_a_silent_guard_proves_nothing]] and
a private note.

A guard firing on the wrong thing is still a guard that works. Six real
submission shapes still block, verified. See
a private note.
