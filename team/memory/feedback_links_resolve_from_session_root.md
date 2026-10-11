---
name: feedback_links_resolve_from_session_root
description: "A file link in a reply opens relative to the session root, never the shell's current dir; link-guard refuses a dead one (10/11)"
metadata:
  type: feedback
---

A markdown file link in a reply is resolved by the editor against the folder the session was opened in, not the directory the shell happens to be in. On 2026-10-11 a tab opened in ~ cd'd into ~/Downloads and linked a render as `TTS%20logo%20helmet%20nalana%20v16.png`; Caleb clicked it and got "Couldn't open that file", then: "Fix chewb this should never happen again for anything I ever click".

**Why:** cwd drifts every time a Bash call cds, and the link text looks right from where the agent is standing.

**How to apply:** write links relative to the session root (or absolute) and only to files that exist. `link-guard.sh` (Stop hook, test `tests/link_guard.sh`) checks every link in the turn's visible text against CLAUDE_PROJECT_DIR, else the transcript's first cwd, and refuses the reply on a dead one. Related: [[feedback_enforce_dont_document]].
