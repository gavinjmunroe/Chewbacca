# Your week in one line

The last line `setup.sh --every-agent` prints, and `chewbacca week` any time after:

```text
Your week: 2 commits in 1 repo (most in myapp, 2). Only on this Mac: 1 repo with uncommitted changes, 1 commit from this week never pushed.
Receipt, with the git command behind each number: ~/.chewbacca/receipts/week-20261013-090355.md
```

It reads the git repos in your usual code folders (`~/code`, `~/Developer`,
`~/dev`, `~/src`, `~/projects` and a few more, three levels deep). It never
opens `~/Desktop`, `~/Documents` or `~/Downloads`, because reading those raises
a macOS privacy dialog. It needs no account, no network and no model.

What it counts, and how it avoids the obvious lies:

- Commits: yours by `git config user.email`, last 7 days, local branches, merges
  left out. A worktree shares history with its repo, so its commits count once.
- Never pushed: a commit on a local branch whose author time and subject are on
  no remote branch. Matching by hash alone called 202 commits unpushed on the
  author's Mac that had all landed under new hashes after a rebase.
- Uncommitted: `git status`, once per repo.
- No remote: a repo with nothing in `git remote`.

A repo you cloned can name programs git runs (an fsmonitor, a clean filter, a
submodule's own filter). Every git call runs with those switched off, and a
filter name that could change how that override parses means status is skipped
for that repo. `tests/test_first_win.py` plants each of these and checks no
marker file appears.

## Receipt

Each line of the receipt pairs a number with the command that reproduces it:

```text
- myapp: 2 commits. `git -C ~/code/myapp log --branches --no-merges --since=7.days.ago --author=stranger@example.com --oneline | wc -l`
- myapp: 1 uncommitted file. `git -C ~/code/myapp status --short`
- myapp: 1 commit not on any remote. `git -C ~/code/myapp log --branches --not --remotes --no-merges --since=7.days.ago --author=stranger@example.com --oneline`
```

On the author's own Mac it read 394 checkouts of 183 repos in 2.8 s under load
30, and the busiest repo's count matched `git log` exactly (1,359).
