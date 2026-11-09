---
name: feedback_per_founder_lists_get_per_sender
description: A folder of lists where each file goes out from a different founder gets a .per-sender marker, or list-guard flags every shared investor as a duplicate.
metadata:
  type: feedback
---

When one folder holds one list per sender (the 13 UCLA showcase founders' investor lists in `~/Downloads/UCLA founders/`), put an empty `.per-sender` file in it. list-guard then runs `list-gate --per-sender` there, so an investor on two founders' lists counts as two senders' emails. Real defects still fail.

**Why:** On 2026-10-26 the stop hook refused "449 people appear on more than one list" on every turn while `list-gate --per-sender` passed the same files. Fixed in a55b979b, tested in tests/list_guard_spaces.sh.

**How to apply:** Any tool that writes per-founder or per-client lists into one folder writes the `.per-sender` marker with them. Superseded versions of a list (the 10/23 padded investor files) move out of the send folder so nobody grabs the wrong one. Related: [[feedback_count_the_empties]].
