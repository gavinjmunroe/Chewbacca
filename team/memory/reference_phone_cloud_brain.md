---
name: reference_phone_cloud_brain
description: With the Mac off, Caleb runs Chewbacca from the phone as a cloud session on the second-brain repo; what that has and lacks.
metadata:
  type: reference
---

The second-brain repo is what a phone cloud session (Claude app, Code tab) runs on when the Mac is off. Set up 2026-10-07.

- `sync-chewbacca.sh` calls Chewbacca `bin/phone-mirror` (docs/guide/PHONE.md, for any kit user) to mirror `~/.claude` (CLAUDE.md, rules, hooks, commands, agents, skills dereferenced, settings with env values REDACTED) into `claude/` on every run.
- The coursework ledger moved to `second-brain/coursework/`; `~/coursework` is now a symlink to it. Before this it had no git and no backup.
- `.claude/skills` links to `claude/skills`, and the root CLAUDE.md has a "Running from the phone" section with the prayer rule and core imports.
- Missing in the cloud: texts, screen, `mac`, peekaboo, local MCPs, people.db message history, secrets.
- With the Mac on, `claude --remote-control` gives the full setup from the phone instead.

Related: [[project_chewbacca]], a private note, [[phone-setup]]

Left off 2026-10-07 night: nothing set up on the phone yet. Next: Code tab on second-brain (check the first session prays and lists deadlines, i.e. phone-start.sh fired), GitHub connector on claude.ai, preferences text from systems/phone-setup.md. Team board CHW-169. Pulls go through brain-pull-safe: phone may write notes, core/, hot.md and MEMORY.md; scripts, CLAUDE.md, dot dirs, claude/ refused. brain-check reports refusals and loaded-file edits as counts.
