---
name: feedback_pollers_never_poke_system_ui
description: A background watcher never polls macOS system UI (Notification Center, the menu bar, Control Center) through Accessibility on a timer; it checks the passive window list first
metadata:
  type: feedback
---

A background watcher never asks macOS system UI for its Accessibility tree on a timer. It checks the window server's passive window list (CGWindowListCopyWindowInfo, no AX) and reads the tree only when the window it wants is actually on screen.

Why: Caleb, 2026-10-17: "My nav bar is oscillating", then "Make sure it never oscilates ever again". The FaceTime call watcher (bin/call-pill, bin/lib/call_pill.py) had run for 4 days from an old kit snapshot, calling `chewie app windows "Notification Center"` every 2 s. appctl retries an empty AXWindows answer 8 times 80 ms apart, so the process that draws the menu bar was polled nonstop with nothing on screen. Stopping the watcher stopped the shaking right away; he confirmed it.

How to apply: any loop that reads Notification Center, Control Center, SystemUIServer or the Dock goes through a passive gate like `call_pill.Ax.banner_up()`, and its test asserts that the idle state makes zero AX calls to that app (tests/test_call_pill.py, test_idle_never_asks_notification_center_for_its_tree). When the screen misbehaves with no visible cause, sample new processes for 60 to 90 s and count what repeats, which is how this was found.
