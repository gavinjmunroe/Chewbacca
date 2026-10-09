---
name: feedback_tccutil_reset_is_destructive
description: "tccutil reset revokes a working macOS permission. Never run it to find out whether a permission exists, and never on a client that is currently granted."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 33849db4-e4b7-428e-886f-7cf21500b64a
  modified: 2026-09-17T01:03:56.585Z
---

2026-09-16, while fixing Chewbacca. `peekaboo see` was hanging, so I ran
`tccutil reset ScreenCapture com.microsoft.VSCode` **to see whether the command
would work without sudo**. It worked. It also wiped VS Code's existing, valid
Screen Recording grant, and peekaboo went from partly broken to completely
broken: even `peekaboo list windows` started failing, because window titles are
screen-recording-gated on macOS 15.

**Why:** `tccutil reset` is not a query. There is no dry run and no undo. The
grant it clears can only be restored by a human toggling it in System Settings,
and for Screen Recording the app usually has to be quit and reopened.

**How to apply:** read TCC state, never reset it to learn about it.

```bash
sqlite3 "/Library/Application Support/com.apple.TCC/TCC.db" \
  "select client, auth_value from access where service='kTCCServiceScreenCapture'"
```

`auth_value` is 2 for allowed and 0 for denied. That read is free and tells you
everything a reset would have. Only reset a client that is genuinely **denied**
(0), say so first, and know that a prompt still has to be answered afterwards.

The same rule covers every command whose name sounds like inspection but whose
effect is deletion: `git clean`, `defaults delete`, `docker system prune`,
`tccutil reset`.

Related: [[project_chewbacca_craft_and_claude_tab]],
a private note, [[feedback_never_hand_him_a_command]].
