---
name: feedback_repo_move_check_branch_tracking
description: After a repo moves owners, check where each branch pushes, not just origin; FF main kept pushing to Gavin's old repo with origin already correct
metadata:
  type: feedback
---

When a repo moves to a new GitHub owner, `git remote -v` showing the right origin proves nothing. On 2026-10-29 the FF repo moved from gavinjmunroe to calebnewtonusc. The handoff note said to run `git remote set-url origin ...`, but origin already pointed at the new repo. The real bug was `branch.main.remote = gavin`, so a plain `git push` kept sending the outbound ledger commits to the old repo.

**Why:** a fix that targets the wrong config line reports success and changes nothing, and the commits keep landing where no deploy watches them.

**How to apply:** run `git for-each-ref --format='%(refname:short) -> %(upstream:short) push:%(push:short)' refs/heads`. Repoint every branch to the new remote with `git config branch.<b>.remote origin` and `--set-upstream-to`. Then run `git remote set-url --push <old> DISABLED` so nothing can push there by accident. Worktrees share the config, so one fix covers all of them. Related: [[project_firm_foundation_site]].
