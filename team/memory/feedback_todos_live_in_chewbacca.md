---
name: feedback_todos_live_in_chewbacca
description: 'Caleb doesn''t use Todoist; "save to todo" means Chewbacca''s work-ledger, scoped to the repo the task is about.'
metadata:
  node_type: memory
  type: feedback
  originSessionId: 49ab54d1-bfc5-40da-ab5c-7ab78a0d1ffd
  modified: 2026-10-08T02:41:41.228Z
---

Caleb, 2026-10-07, after a "save to todo" landed in Todoist: "For rn I don't use todoist, chewbacca is my digital life."

**Why:** Todoist is a dead channel for him; anything put there is never seen again.

**Personal vs team, 2026-10-07:** "There's a diff between my personal todo and the chewbacca team todo, that should be obvious every time." Personal todo = work-ledger, only things in Caleb's own hands. Team todo = the team board (`team add`), for anything a teammate owns or any product build, even if he says "chewb todo". Split mixed requests and say which went where.

**How to apply:** a personal todo goes in `work-ledger add --scope <repo or ~/second-brain> --title ... --source-key ... --owner Caleb --next-action ...`, with the detail in the repo's own docs. `~/.claude/commands/todo.md` now does this. Todoist commands in Chewbacca's repo stay for other users. See [[project_amber_fridge_site]] for the first one moved over (live 3D objects).
