---
name: team
description: "The Chewbacca team's task board, stored in this repo and shared with a web board. Use when anyone asks what the team is working on, who owns something, what's due, what's assigned to them or to Gavin, Jake or Semyon, or asks to add, assign, move, comment on or finish a task. Also use to post the week's tasks after the Monday check-in and to collect proof on Friday. Also fires on: to-do, todo, tracker, task board, linear, backlog for the team, who's on what, assign this, mark done."
---

# Team board

This board is the team todo. Caleb's personal todo is the work ledger, and the
split is by owner: anything Gavin, Jake or Semyon owns, or any build of the
product, lands here even when he says "chewb todo"; only things in his own hands
(a text, an access request) go in the ledger. He flagged mixing them on
2026-10-07. Split a mixed request and say which went where.

Run `team`. It reads the fetched `origin/main`, so it shows what the web board shows.

| Ask | Run |
| --- | --- |
| What's everyone on? | `team` |
| What's mine? | `team mine` (set `TEAM_ME=Gavin` to act as someone else) |
| Add a task | `team add "title" --owner Semyon --due 2026-10-06 --priority high --done-when "..."` |
| Start / review / finish | `team move CHW-3 in_progress`, `team move CHW-3 in_review`, `team done CHW-3 --proof <link>` |
| Reassign or edit | `team assign CHW-3 Jake`, `team edit CHW-3 --due 2026-10-09` |
| Note something | `team comment CHW-3 "text"` |
| What changed? | `team feed` |
| What's untriaged? | `team inbox` |
| Pull BACKLOG.md in | `team import` (preview), `team import --apply` (one commit), `team unimport "BACKLOG.md"` (undo untouched) |
| Link commits now | `team sync` (every `team` command also does it) |
| Open in a browser | `team open CHW-3` |

It always targets calebnewtonusc/Chewbacca: a remote pointing there by any name, or the URL
itself, so a fork checkout never files tasks on the fork. It knows who you are from
`TEAM_ME`, your git name, or your `gh` login, matched against `team/members.json`.

Rules the tool enforces, so do not work around them:

- Owners must be in `team/members.json`. An unknown name is refused with the list.
- Done needs proof. A link, a video or a commit, never "it's done" in chat.
- Writes are one-file commits pushed straight to `main` without touching the working
  tree, so it is safe to run in a checkout with uncommitted work in it.

Commits drive tasks. Put the id in the message: any mention of `CHW-12` logs the commit on
that task and moves it from Inbox, Backlog or Todo to In progress; `fixes CHW-12` (or
closes, resolves) marks it Done with the commit as proof. The CLI and the web board both
run this against the newest 120 commits on main, idempotently.

Never edit `team/tasks/*.md` by hand in the working tree and commit it: a hand edit
races the web board. Use `team edit`, or the board.

The weekly rhythm this serves: Monday, after the 15-minute check-in with Karthik,
post each person's one task. Friday by noon, each task shows proof.
