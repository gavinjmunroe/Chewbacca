---
name: feedback_send_file_stages_in_pictures
description: Files sent over iMessage go through `send-file`, which stages them in ~/Pictures; an AppleScript send straight from ~/Downloads sticks as a blank icon that never loads.
metadata:
  type: feedback
---

To text someone a file, run `send-file <handle> <path> [--text "..."]`. It copies
the file to `~/Pictures/chewbacca-send/`, sends it, and exits 0 only once chat.db
shows the transfer finished (state 5, is_sent 1).

**Why:** Messages is sandboxed. Given a `~/Downloads` path by AppleScript it makes
the bubble but never reads the file: transfer_state 6, is_sent 0, and the
recipient sees a blank file icon. On 2026-11-02 a CSV for Chibo stuck that way
while Caleb's own drag of the same file sent at once, and he said the same thing
happened with files for Colin the day before. The same send from `~/Pictures`
reached state 5 in under 2 seconds.

**How to apply:** never hand-roll `send (POSIX file ...)` from Downloads. If
`send-file` exits 1, the file did not go: say so, don't report it sent.
