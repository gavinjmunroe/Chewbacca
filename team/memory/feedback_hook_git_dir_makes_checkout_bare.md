---
name: feedback_hook_git_dir_makes_checkout_bare
description: "fatal: this operation must be run in a work tree" in the shared checkout = core.bare flipped to true by a test that a git hook ran with git's GIT_DIR still set; set it back, the scrub in pre-push (1d45d276) is the fix
metadata:
  type: feedback
---

Git exports GIT_DIR (and its friends) to every hook it runs. A test the hook
runs that does `git -C <temp repo> init` then re-initialises the repo being
pushed instead of the temp one, and from a linked worktree (which is how
`chewbacca land` pushes) it writes `core.bare = true` into the shared config.

On 2026-10-13 the shared `~/code/chewbacca` checkout broke for every tab twice
in an hour, at 00:19 and 00:52, each right after a land that touched
`.claude/hooks`: pre-push ran tests/test_hookd_dispatch.py, which does
`git -C <temp> init`. Reproduced in a scratch repo with a worktree:
`GIT_DIR=<worktree gitdir> git -C x init` flips core.bare.

**Why:** a hook's environment is not a clean shell. Anything a hook runs
inherits the hook's view of which repo it is in.

**How to apply:** if git in the shared checkout says "must be run in a work
tree", run `git --git-dir=$HOME/code/chewbacca/.git config core.bare false`.
Any hook that runs tests or tools sources `.githooks/scrub-git-env.sh` first
(pre-push does since 1d45d276; tests/githooks_git_env.sh holds it). Hooks run
from the shared checkout's own `.githooks`, so the fix is live only once that
checkout has the commit. Related: [[feedback_land_workflow_traps]],
[[feedback_shared_checkout_mid_merge]].
