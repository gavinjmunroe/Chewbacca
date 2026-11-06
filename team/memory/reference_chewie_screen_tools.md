---
name: reference_chewie_screen_tools
description: chewie text is on-device OCR, chewie notifications reads Notification Center, and chewie app press draws a marker first. What each can and can't see.
type: reference
---

`chewie text --app X` is macOS Vision OCR on the window's pixels, with no model call. It read a Safari page in 0.69 to 0.89 s at load 25 on 2026-11-06, and 1.1 to 3 s at load 90. The screen memory build should call `appctl text`, which returns lines with boxes in window points.

`chewie notifications` reads through agent-desktop. Headless, macOS has no Notification Center window unless a banner is up, so it answers an empty list with `panel: closed`. Only `--open` reads the history, and it takes focus for a moment. With a Focus mode on, banners never appear, so an `osascript display notification` probe proves nothing, and it didn't land in the history either. The real history came back 7 rows with focus restored. `--open` failed with -600 until System Events was running, so the reader starts it with `open -g` and retries once.

The marker before `chewie app press` costs one extra `press --check`. Three separate appctl calls took a press from 0.24 s to 2.73 s at load 91, so `--check` now returns the gate, the rectangle and `on_screen` together. Kyber closed means no extra call and no wait. The pixels aren't verified, because the glass can't be screenshotted.

commit-deletes-guard judges the hook's cwd, not the checkout a `cd` or `git -C` names. On 2026-11-06 the shared checkout's index held another tab's staged deletions, so every commit in a clean worktree was refused. `chewbacca land --paths` from the worktree went through without an override.
