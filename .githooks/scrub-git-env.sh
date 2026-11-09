# Sourced by a git hook before it runs anything that might call git on
# another repo. Git exports GIT_DIR (and friends) to every hook, so a test
# the hook runs that does `git -C <temp repo> init` re-initialises THIS
# repository instead, and from a linked worktree it writes core.bare = true
# into the shared config. On 2026-10-13 that happened twice in an hour: a land
# that touched .claude/hooks ran tests/test_hookd_dispatch.py from pre-push,
# and the shared ~/code/chewbacca checkout stopped working for every tab
# ("fatal: this operation must be run in a work tree"). Reproduced in a
# scratch repo: GIT_DIR=<worktree gitdir> git -C x init flips core.bare.
# The hook keeps its cwd (the work tree root), so its own git calls still
# find this repo by discovery.
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars 2>/dev/null)
