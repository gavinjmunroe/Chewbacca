---
name: project_meeting_live_2026_11_06
description: Live call reaches a tab or Kyber with no pasting (`meeting-live`), built on room-capture; what was decided about Natively and Highlight style tools
type: project
---
`meeting-live` reads the transcript room-capture already writes every 15 s. A tab that asks about the call gets new lines per prompt (`.claude/hooks/meeting-live.sh`), `kyber-surfaces open live` is the panel, and `meeting-live ask` answers with no tools. Code: bin/lib/meeting_live.py.

Decisions, 2026-11-06:
- No code or prompts from Natively. Its Personal Use Source License v1.0 bars using source, architecture or prompts commercially, so its source was never read. Ideas only.
- No interview mode and no hiding from screen share. Caleb: "obv I dont wanna do the cheating aspect for technical interviews".
- A private call (meeting_privacy) reaches no tab, panel or model.
- Build capabilities natively rather than installing those apps. Two audits compare 11 repos plus Highlight against Chewbacca.
- Before building a capability, check what exists: `call-listen`, `room-capture` and `meeting-autopilot` already covered most of this. `call-listen`'s `call-ears`, `call-watch` and `whisper-server` weren't on PATH that day, so it had rotted unnoticed.

Corrections that day: "GRAPH ENGINEER BRUH" and "I thought we had built in graph engineering so I no longer hv to tell you?" on big multi-part work; "A ton of this should be shared across our repos... I shouldnt hv to tell you this". Mic and system audio don't fit web products, so Anchored doesn't get this; Hall does. The transcript is local data and never shared.

Limit: lag is a 15 s chunk plus transcription, so it serves asks and not instant cues. Speaker labels are guesses from one mixed track.
