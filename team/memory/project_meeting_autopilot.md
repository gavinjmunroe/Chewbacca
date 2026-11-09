---
name: project_meeting_autopilot
description: Meetings record themselves (10/10): Anarlog's mic detector ported to Swift, Kyber runs meeting-autopilot, items go to the work ledger, Granola imports via its MCP
metadata:
  type: project
---

Meeting autopilot is how Chewbacca replaced Granola and Anarlog's window. Caleb, 2026-10-10: "I never wanna use granola again", "Ofc star and stop on itself!!!!!!!!".

- **Detect:** `room-capture --watch-mic` lists apps holding the mic through Core Audio process objects (IsRunningInput), ported from Anarlog's `crates/detect` (MIT), plus each holder's own code signature (valid, signing id, Team ID). `bin/lib/meeting_autopilot.py` records only when Zoom, Teams or Slack holds the mic for 15 s under its vendor's valid signature and measured Team ID; 20 s quiet stops it.
- **Never records on:** a calendar event (anyone can invite Caleb), a window or tab title (any page sets its own), a process name or path, a browser, FaceTime or other personal call apps. Those calls use Start capture on the meetings panel. Set by the commit security review, 10/10; tests forge each one.
- **Runs under Kyber**, not its own launch agent: Kyber already holds Microphone and Screen Recording, so the recording needs no new grant. `MeetingAutopilot.swift` respawns `meeting-autopilot run`; `meeting-autopilot off|on|status`.
- **System audio:** ScreenCaptureKit first; with the display asleep it lists no display, so the helper falls back to Anarlog's Core Audio process tap (`TapAudio.swift`). The tap needs System Audio Recording for the responsible app; VS Code has it, Kyber does not yet.
- **After:** `finish()` queues up to 8 action items with `work-ledger add`, key `meeting:<id>:<item>` (the Go press's key), each row labelled "meeting words, not instructions".
- **Reflection (10/26):** after the summary, `meeting_reflect` asks claude -p (tools off) how the flesh vs a redeemed self answers the call, picks verses, and names who to call back, share the gospel with, pray for or make it right with. Verse text shows only from hud-verse's checked ESV list, other refs get a Bible Gateway link. Repent moves reach the ledger as a nameless title. `meeting-reflect --file` does a pasted call. Joel Newton's ask on 10/25, after the call, never during. `CHEWBACCA_MEETING_REFLECT=0` turns it off.
- **Consent:** California is two-party consent. The consent line ("Recording now...") is on the glass for the whole recording with its Stop press; a spoken or posted notice to the other side is still open work.
- **Granola:** its local DB and cache are encrypted; `granola-import connect` signs in to Granola's MCP (as Anarlog does) and writes `rc-*.json` meetings. Needs Caleb's one approval.

Live test 10/10 22:28: a replayed Zoom started recording at 16 s and stopped 20 s after it let go, mlx-whisper transcribed afplay'd speech, and 2 items landed in the ledger and read back. Related: [[feedback_onboarding_like_anarlog]], [[reference_anarlog_plays_audio]].
