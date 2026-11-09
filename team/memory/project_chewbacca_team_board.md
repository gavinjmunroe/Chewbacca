---
name: project_chewbacca_team_board
description: Chewbacca's team task board: tasks are team/tasks/CHW-n.md in the Chewbacca repo, edited by the `team` CLI and a web board at team-web-production.up.railway.app
metadata:
  type: project
---

Chewbacca's team board is the one tracker for Caleb, Gavin, Jake and Semyon, built
2026-10-04 after Caleb asked for "same functionality as Linear, bidirectional sync to the
repo" and then for "the entire chewbacca todo list" in "a fat inbox".

- Store: one markdown file per task, `team/tasks/CHW-n.md` on `main` of calebnewtonusc/Chewbacca. No database.
- Terminal: `team` (board, mine, inbox, add, move, assign, done --proof, comment, feed, import, sync). Writes are one-file commits pushed without touching the working tree.
- Web: https://team-web-production.up.railway.app, Railway project `chewbacca-team`, GitHub OAuth app "Chewbacca Team" on calebnewtonusc. Anyone with push access signs in; every edit is a commit under their name.
- Design follows Linear's DESIGN.md from VoltAgent/awesome-design-md, copied to `apps/team-web/reference/`. The first version (orange accent, gradient, glow) got "TS looks ai slop bro". See a private note.
- Inbox holds all 129 open BACKLOG.md items plus the 7 OS handoff items, each with a `source` so re-import never duplicates and `team unimport` undoes untouched ones.
- Commits sync tasks: a subject or trailer line with CHW-12 starts the task, "fixes CHW-12" closes it with the commit as proof. Body prose does not count: the feature's own commit closed CHW-12 by describing itself, fixed and undone the same night.
- GitHub Actions jobs refuse to start on Caleb's account billing (seen 2026-10-04), so the sync runs in the CLI and the web server instead. Lint has failed every push for the same reason. Billing is Caleb's call.
- Supersedes the Linear and Gavin's-tracker options in a private note T008/T162.

**Week of 2026-10-09 to 10-16, set that night at Caleb's ask ("get the chewbs shared todo super perfect for the next week").** Todo holds only what's due by the 16th, about 26 tasks across Caleb, Gavin, Jake and Semyon. Everything else moved to Backlog, nothing was deleted. CHW-137 (WhatsApp and Slack reads) is done with commits as proof. New that night: CHW-185 (gmail.py review findings), CHW-186 (Slack-to-people linking), CHW-187 (evaluate docs/plans/LINKS-FROM-CALEB.md, Gavin). The `team` CLI now reads the board in one git call and times out network calls at 60s, see [[feedback_slow_means_broken]].
