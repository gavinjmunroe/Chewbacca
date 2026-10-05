# Team board

Every task is one file in `tasks/`, named by its id (`CHW-12.md`). The terminal
and the web board read and write these same files on `main`, so there is one
board and nothing to sync.

- In Chewbacca: `team` (board), `team mine`, `team add "title" --owner Gavin --due 2026-10-07`,
  `team move CHW-12 in_progress`, `team done CHW-12 --proof <link>`, `team comment`, `team feed`.
- In a browser: the URL in `config.json`, signed in with GitHub. Anyone with write
  access to this repo can use it, and every edit is a commit under their name.

`members.json` is who a task can be assigned to. Add yourself with your GitHub
handle so your edits on the web are logged under your name.

A task moves to Done only with proof: a link, a video or a commit.

Commits keep the board in sync: mention `CHW-12` in a commit message and it is logged on
that task and moved to In progress; write `fixes CHW-12` and it is closed with the commit
as proof. New work lands in the Inbox to be triaged; `team import` brings BACKLOG.md in.

Built with Chewbacca
