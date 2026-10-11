---
name: project_meeting_autopilot
description: Meetings record themselves (10/10): Anarlog's mic detector ported to Swift, Kyber runs meeting-autopilot, items go to the work ledger, Granola imports via its MCP
metadata:
  type: project
---

Meeting autopilot is how Chewbacca replaced Granola and Anarlog's window. Caleb, 2026-10-10: "I never wanna use granola again", "Ofc star and stop on itself!!!!!!!!".

- **Detect:** `room-capture --watch-mic` lists apps holding the mic through Core Audio process objects (IsRunningInput), ported from Anarlog's `crates/detect` (MIT). `bin/lib/meeting_autopilot.py` decides: a work call app (Zoom, Teams, Webex, Slack) on the mic 15 s starts it; a browser counts only with a meeting tab on screen or a call on the calendar; FaceTime, WhatsApp, Discord and the like only with a calendar call. 20 s with nothing stops it. An allow list, because Siri's corespeechd and hud-listen hold the mic all day (seen 10/10).
- **Runs under Kyber**, not its own launch agent: Kyber already holds Microphone and Screen Recording, so the recording needs no new grant. `MeetingAutopilot.swift` respawns `meeting-autopilot run`; `meeting-autopilot off|on|status`.
- **System audio:** ScreenCaptureKit first; with the display asleep it lists no display, so the helper falls back to Anarlog's Core Audio process tap (`TapAudio.swift`). The tap needs System Audio Recording for the responsible app; VS Code has it, Kyber does not yet.
- **After:** `finish()` queues every action item with `work-ledger add`, key `meeting:<id>:<item>`, the same key a Go press uses.
- **Granola:** its local DB and cache are encrypted; `granola-import connect` signs in to Granola's MCP (as Anarlog does) and writes `rc-*.json` meetings. Needs Caleb's one approval.

Live test 10/10 22:28: a replayed Zoom started recording at 16 s and stopped 20 s after it let go, mlx-whisper transcribed afplay'd speech, and 2 items landed in the ledger and read back. Related: [[feedback_onboarding_like_anarlog]], [[reference_anarlog_plays_audio]].
