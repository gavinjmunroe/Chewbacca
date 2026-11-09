# Your week in one line

The last line `setup.sh --every-agent` prints, and `chewbacca week` any time after:

```text
Your week: 2 commits in 1 repo (most in myapp, 2). Only on this Mac: 1 repo with uncommitted changes, 1 commit from this week on no remote.
Receipt, with the git command behind each number: ~/.chewbacca/receipts/week-20261013-090355.md
```

It reads the git repos in your usual code folders (`~/code`, `~/Developer`,
`~/dev`, `~/src`, `~/projects` and a few more, three levels deep). It never
opens `~/Desktop`, `~/Documents` or `~/Downloads`, because reading those raises
a macOS privacy dialog. It needs no account, no network and no model.

What it counts, and how it avoids the obvious lies:

- Commits: yours by `git config user.email`, last 7 days, local branches, merges
  left out. A worktree shares history with its repo, so its commits count once.
- On no remote: a commit on a local branch whose change (its `git patch-id`)
  no remote branch holds. Matching by hash alone called 202 commits unpushed on
  the author's Mac that had landed under new hashes after a rebase. Matching by
  subject and author time hid an amended commit whose content never left.
- Uncommitted: `git status`, once per repo.
- No remote: a repo with nothing in `git remote`.

A repo you cloned can name programs git runs (an fsmonitor, a clean filter, a
submodule's own filter). Every git call runs with those switched off, the
receipt's commands too. A filter name that could change how that override
parses means status is skipped for that repo, and the line says so instead of
calling it clean. `tests/test_first_win.py` plants each of these and checks no
marker file appears.

## Receipt

Each line of the receipt pairs a number with the command that reproduces it:

```text
- myapp: 2 commits. `git -c core.fsmonitor=false -c core.hooksPath=/dev/null ... -C ~/code/myapp log --branches --no-merges --since=7.days.ago --author=stranger@example.com --oneline | wc -l`
- myapp: 1 uncommitted file. `git -c core.fsmonitor=false -c core.hooksPath=/dev/null ... -C ~/code/myapp status --porcelain --ignore-submodules=all`
- myapp: 1 commit not on any remote. `git -c core.fsmonitor=false -c core.hooksPath=/dev/null ... -C ~/code/myapp log --branches --not --remotes --no-merges --since=7.days.ago --author=stranger@example.com --oneline` lists candidates; one whose change is on a remote under another hash (same `git patch-id`) counts as pushed.
```

On the author's own Mac it read 394 checkouts of 183 repos in 2.8 s under load
30, and the busiest repo's count matched `git log` exactly (1,359).
