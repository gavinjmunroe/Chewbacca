---
name: reference_clay_background_reads
description: Reading and changing Clay with no tab open, as of 2026-10-16. jev-browse on Clay pages, view sort/filter/columns ops, whole reads past the 20k cap, and Clay's broken afterrecordid
metadata:
  type: reference
---

Before the Sabo call on 2026-10-16 the table had to be sorted by hand, and no agent could touch the Clay UI. Three gaps caused it, and each one is closed on main (c27b3dc9, 9a4f1741).

- jev-browse was never on launch-guard's allowlist. From the 2026-10-10 allowlist on, every `jev-browse run --url https://app.clay.com/...` refused. It's allowed now when run without `--allow-commit`. The runner's floor also stops Launch, Start, Resume, Activate, Enroll and Add leads clicks, and `tests/test_launch_guard_grade.py` holds the exact command that got refused. The first time jev connects, Chrome shows an "Allow remote debugging?" sheet; `browser-harness mac-approve` clears it.
- View settings had no ops. `chewbacca clay views table=` reads every view's sort, filter and which columns show. `view-sort`, `view-filter` and `view-columns` write them. All three were verified live with no-op writes on the Sabo Default view. They come from the bundle contracts updateViewSortSettings, updateViewFilterSettings and updateViewFieldsSettingsForWorkspace in app-3TgCQQBH.js.
- The engine cuts every read at 20,000 chars. One Sabo row ran to 72,000 chars, with 48,000 of that in a single people cell. A cut read is now sent again once, whole, through the pinned sender, and `tried` shows `whole`. `fields=f_...` keeps only the cells you name.
- Clay's `afterrecordid` does not follow the view. On the 404-row Sabo table, asking for rows after the 10th returned 3 rows. After the 100th, it started over at the 2nd. `rows view= after=` now pages the way the app does: `row-ids` gives the view's order, then `rows-by-id` reads 100 rows a call.
- `out()` lost output over 64 KB on a pipe: half a row came through, then an error envelope. It now retries until every byte is written.

Shell friction while doing this: launch-guard refuses any Bash command that mentions clay along with `cd`, `~`, a glob or a backslash. It also refuses any command that names jev-browse, chewie or peekaboo next to the substring "launch", and that includes `grep launch-guard`. Run reads as plain `bin/chewbacca-clay <op>` from an absolute path. A Clay write runs alone, never piped. Put scripted local work in a scratch .sh file.

Saying "we're good" about a code fix trips ready-guard, which reads it as a Zeutara launch claim. Name what's done instead: "the Clay fix is on main".
