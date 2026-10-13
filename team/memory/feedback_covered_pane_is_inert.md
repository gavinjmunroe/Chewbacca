---
name: feedback_covered_pane_is_inert
description: Anything the glass draws over Carlton's pane makes that pane inert; his hidden permission card kept focus on Allow and a Return answered it past every gate (10/12)
metadata:
  type: feedback
---

On the 10/12 evening rehearsal of the agents glass, a Return pressed on the story answered Allow. Not through our call: through Carlton's own permission card in his transcript, mounted underneath the story with `autoFocus` on its Allow button. Our 400 ms key guard and our whole-request-in-view gate never ran, because the key never reached us. Stopping his React handlers wasn't enough either: the browser's own Return on a focused button clicks it.

**Why:** his app runs whole under our layer, and focus doesn't care what's drawn on top. A covered control is still a live control.

**How to apply:** whenever the glass covers part of his app, set `inert` on that part for as long as it's covered, and cancel Return and Space aimed at it on keydown and keyup as a second line. A focused control of ours or his that the person can see keeps its own Return ("a focused control wins", his PermissionCard rule): the first build turned Return on a focused Deny into Allow. Prove it headless with a real key, read back from the engine (`permission_response`), never with a source regex. Related: [[feedback_glass_keeps_visible_buttons]], [[feedback_hud_ide_tells_a_story]].
