---
name: feedback_take_me_there
description: whenever a step needs Caleb in a settings pane or a web page, open it for him in the same turn instead of naming the path
metadata:
  type: feedback
---

2026-10-10 morning: I told him "System Settings > Privacy & Security > Automation > Claude > Messages" and he said "Always take me there fix chewbs".

**Why:** a path in prose makes him hunt through menus for a step that's already his-hands-only. The click is his; the navigation never should be.

**How to apply:** for a macOS permission, `open "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_<Anchor>"` (Automation, AllFiles, Accessibility, ScreenCapture, Microphone, Contacts, Calendars), or `chewbacca-permissions guide --only <id>` for the drag-card walkthrough. For a web console step, open the exact URL. Say "opened it" and name only the one switch left. `people send` and `people texts drafts` now open the Automation pane on their own when Messages is blocked (once per 10 min). Related: [[reference_messages_automation_denied]], [[feedback_onboarding_like_anarlog]], [[feedback_dont_report_what_you_can_fix]].
