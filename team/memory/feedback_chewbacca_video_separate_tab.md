---
name: feedback_chewbacca_video_separate_tab
description: "When recording a video of Chewbacca, always drive it in a SEPARATE Claude tab via claude-tab, never in the session doing the recording and never in a hand-rolled Terminal window."
metadata:
  node_type: memory
  type: feedback
---

Caleb, 2026-09-16, twice in one session and the second time as a standing rule:

> "I literally just taught you how to open and control a new claude extension
> tab in vscode"
> "When making a video interacting with chewbacca, ALWAYS operate with it in a
> different tab"

**Why:** the session doing the recording is full of agent scrollback, tool
calls and prayer text. It is not a demo surface. A hand-rolled AppleScript
Terminal window is worse: it throws away `bin/claude-tab`, which he built the
same morning precisely so this would be one command.

**How to apply:** `./bin/claude-tab new` to open the demo tab, `claude-tab
window` for the VS Code window id, `cap record start --detach --window <id>`,
then `claude-tab ask "<prompt>"` to drive it. The tab being filmed is Chewbacca
answering; this tab only operates the camera.

The standard he named: open a new tab, type one sentence like "Sagar asked for
a video, make it and send it to him", and the finished video comes out with no
further instruction.

Related: [[project_chewbacca_craft_and_claude_tab]], [[project_chewbacca]],
[[feedback_never_hand_him_a_command]].
