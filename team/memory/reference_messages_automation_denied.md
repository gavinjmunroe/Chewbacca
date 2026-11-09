---
name: reference_messages_automation_denied
description: macOS denies the Claude desktop app Automation control of Messages (osascript -1743), so no iMessage can send from a Code tab until Caleb flips it in System Settings
metadata:
  type: reference
---

Found 2026-10-09 at about 3am while building group sends. `osascript -e 'tell application "Messages" to count chats'` returns -1743 "Not authorized to send Apple events to Messages", and `mac doctor` reports `automation:Messages: denied`. `mac messages send` goes through the same permission, so every iMessage draft queued that night would have failed the next morning. WhatsApp and Slack sends don't need it.

The fix is a security setting, so it's Caleb's hands only: System Settings > Privacy & Security > Automation > Claude (or the terminal app) > Messages on. Never toggle it, never script around it.

`people send` and `people texts drafts send` now probe with that read-only count first (0.2s) and print the path, and the drafts list warns before he picks numbers. If sends still fail after the toggle, the permission wasn't the cause. Re-run `mac doctor` before guessing.

Related: a private note, a private note
