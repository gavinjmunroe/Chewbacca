---
name: feedback_automation_runs_on_server
description: "Client automation runs on the team's server (Togari on Railway), never on Caleb's Mac; if a shortcut puts it on the Mac, say so before shipping."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 380d5ca0-cf58-46a3-9497-41e9d7e2940e
  modified: 2026-10-09T09:34:04.040Z
---

2026-10-09 ~2:20am, after the Zeutara reply autopilot shipped as a launchd job on his Mac: "Bro why is my mac the one handling the autopilot wtf????? The whole point is togari does it!!!!!!!!!!" then "Fuck you".

**Why:** the Mac version was chosen silently because Clay's inbox actions (forward, reply, blocklist) only work from a logged-in Clay session. That made a client system depend on his laptop being awake, with Chrome open, and he found out last.

**How to apply:** anything that acts for a client (Jonah, Zeutara) lives in togari-platform on Railway. If the only working path is local, say it in the first line, before building, and name what the server version needs. Next step for Zeutara: Clay sequencer webhook for every reply into Togari, OOO follow-ups through the existing Clay reply hook, Qube copies via Blue Modern delegation, then find a server-callable Clay action for resends and blocklist. Related: a private note, [[feedback_clay_api_vs_ux]].
