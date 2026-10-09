---
name: feedback_applescript_launches_the_app
description: Any AppleScript or `mac <app>` call launches that app, so a background poller reopens it after every quit. Gate pollers on pgrep.
metadata:
  type: feedback
---

Any `tell application "X"` launches X if it's closed, and the `mac mail` / `mac calendar` CLIs work that way too. On 2026-10-09 Caleb asked why Mail kept reopening after he force quit it. The cause was kyber-surfaces' osgraph ingest reading unread mail every 60 s. Fixed in Chewbacca b9b9323e: the mail ingest runs only while `pgrep -xq Mail` says Mail is open, and a test in tests/test_osgraph.py pins it.

**Why:** a timer plus a launch-on-call API makes a quit that never sticks, and nothing logs it.

**How to apply:** any new background reader of a Mac app checks that the app is running first, and leaves the last data in place when it isn't. Better still, read mail through Gmail instead ([[feedback_never_mail_app]]). The symptom and the search steps are in the mac-debug skill. Related: [[project_chewbacca_os]].
