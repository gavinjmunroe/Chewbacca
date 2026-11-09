---
name: project_kit_runtime
description: PATH tools run from ~/.chewbacca/kit/current, a detached worktree of origin/main nobody edits, not from the shared checkout; how it updates, what it links, how to check it.
metadata:
  type: project
---

The kit runtime is `~/.chewbacca/kit/current`, a symlink to `snapshots/<sha>`, a detached git worktree (unlocked, so `git worktree prune` cleans up snapshots whose directory is gone) of origin/main. Every kit tool in `~/.local/bin` links through `current`, so PATH runs main, never another tab's uncommitted edit. Built by `tools/kit_runtime.py`.

**Why:** on 2026-10-10 13:17 every PATH tool linked into the shared checkout `~/code/chewbacca`. Six tabs kept edits there, local main was 2 commits ahead of rebased copies on origin, `git reset --keep origin/main` refused, and the installed `chewbacca` front door still refused writes main had allowed since 19539ff1. Caleb kept getting handed commands.

**How it stays current:** kit-autopull (SessionStart) runs `kit_runtime.py update --fetch --link-bin ~/.local/bin` (fetch at most every 5 min), then syncs `~/.claude/hooks` from the same sha. launchd `com.chewbacca.kit-runtime` runs the same update every 15 min. setup.sh builds it before the first link_tool and installs the timer.

**How it is safe:** a new snapshot is built beside the old, then `current` is swapped with rename(2); a tool that already resolved keeps its snapshot. Three snapshots are kept. Gitignored state in the source checkout (node_modules, hud/build, superassistant/questions.jsonl) is symlinked into each snapshot. The shared checkout's tree, index and HEAD are never touched. A different checkout cannot repoint the runtime without `--adopt`.

**How to apply:** `chewbacca doctor` reports the runtime sha against origin/main, and `python3 tools/kit_runtime.py status` says the same. A new tool only on a branch links into the checkout until it reaches main; the next update moves the link. Never edit files under `~/.chewbacca/kit`: they are replaced.
