---
name: feedback_one_api_per_reminder
description: Reminders writes and their undo go through one API; the mac CLI's EventKit ids need x-apple-reminder:// in AppleScript, and mixing the two left an undone reminder still done (10/11)
metadata:
  type: feedback
---

A Reminders write and the thing that reverses it go through the same API. On 2026-10-11 the chewbacca-mcp `reminders.complete` write ticked a reminder through `mac` (EventKit) and its undo unticked it through AppleScript. Read back right away, AppleScript still saw it not done after the tick, and the reminder ended up done after the undo. Doing both through AppleScript held on the live rerun.

Second trap from the same run: `mac reminders` hands out a bare EventKit UUID, and Reminders' AppleScript only finds `x-apple-reminder://<UUID>` (the bare id fails with -1728).

**Why:** a fake that accepts any id and updates instantly passed both bugs. Only the live run on a throwaway reminder caught them.

**How to apply:** pick one door per store for the write and its inverse, and convert ids at the boundary (`asScriptReminder` in `bin/lib/mcp-writes.js`). The fake in `tests/mcp_writes.sh` now refuses a bare id like the real app. Before calling a new app write done, run it once live on a throwaway item and read it back. Related: [[feedback_never_read_only]], [[project_mac_db]].
