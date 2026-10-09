---
name: feedback_use_the_ui_not_just_cli
description: "When a CLI path is slow or limited, drive the web UI with jev-browse/chewie web instead of waiting or calling it blocked."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 53bb1573-84f4-461c-ab52-e83799e828a5
  modified: 2026-10-07T17:28:34.381Z
---

2026-10-05, Zeutara Wave 2: I sat on a sequential `clay_run.py` (56 searches, one at a time) and told Caleb it'd take 20 minutes, after earlier calling a Clay UI upload "something someone has to do". He: "Bro you can USE THE CLAY UX" and "you know how to navigate literally any ux especially with the jev browser agent".

**Why:** the CLI covers a fraction of Clay; the UI (Find People, enrichment columns, table pushes) does the rest in minutes. Waiting on a slow script or naming a UI step as a blocker is the do-it-yourself failure.

Same night: "Never fall back, always find a way to navigate any ux if that is the best route. It as of now is the best way to use clay." The Clay UI is the PRIMARY path for Clay, not a fallback for the CLI.

2026-10-07, midweek wave, SECOND time: I spent an hour fighting CLI workflow-node mappings ("Invalid node config"), then wrote `scripts/midweek_drafts.py` to build six campaigns. He: "WHy do you need a script. WE made you cracked at navigating clay ux w jev!!!!!!! I should never have to say this ever again." The first time the CLI refuses a shape, switch to the UI through the jev browser tool (`~/.chewbacca/jev-ultrafast/.venv/bin/browser-harness`) on his real Chrome (`new_tab`, `js`), not another CLI attempt and not a new script.

**How to apply:** the moment a CLI path is slow, missing a capability, or "UI only", drive the UI: `jev-browse run` for narrow goals, `chewie web` / `chrome-js` for reads, in the client's Chrome profile. Only real blockers stay blocked: a send/launch press needs his yes. See a private note, a private note.
