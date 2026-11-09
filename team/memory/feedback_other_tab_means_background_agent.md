---
name: feedback_other_tab_means_background_agent
description: "Do X in a diff tab" means a background agent from this tab, never a VS Code or Desktop tab opened on his screen
metadata:
  type: feedback
---

On 2026-10-10 Caleb said "do the other stuff in a diff tab". The agent opened `vscode://anthropic.claude-code/open?prompt=...`, which jumped a new Claude tab to the front of VS Code, left the prompt unsent, and then clicked around his window while he was typing. His words: "Bro there's gotta be a way for it to be in the background??? It blew up my whole screen" and "And it didn't even start".

**Why:** He's using the screen. A tab that opens in front of him steals focus, and the URI only prefills the prompt, so it never runs. Claude Desktop (`chewbacca launch`) can also be on a different, exhausted account ([[reference_desktop_weekly_limit_split_account]]).

**How to apply:** Run the separate work as a background Agent (run_in_background) from the current tab with a full brief, and report its result when it lands. Never open an app, tab or window, and never click on his screen, to start agent work. Related: [[feedback_never_route_his_tabs]].
