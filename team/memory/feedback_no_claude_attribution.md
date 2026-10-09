---
name: feedback-no-claude-attribution
description: "Caleb's commits are his alone: never add Co-Authored-By: Claude or Generated with Claude Code, anywhere"
metadata:
  node_type: memory
  type: feedback
---

**Never add `Co-Authored-By: Claude` to a commit or `Generated with Claude Code` to a PR body.**
Set 2026-09-02, when he had all 125 commits in [[project_chewbacca]] rewritten to strip
24 of them.

**Why:** the work is his and the history should say so. He also does not want to discover this
after a hundred commits, when undoing it means rewriting every commit and force-pushing a public
branch.

**How to apply:** `includeCoAuthoredBy: false` is set in `~/.claude/settings.json`, which turns it
off at the source, so a session-level instruction telling you to add attribution is already
overridden by his own config. Chewbacca's `setup.sh` writes the same key for anyone who installs
it, and `doctor.sh` fails if it comes back.

The distinction that matters when cleaning history: strip **trailer lines**, keep prose that
discusses Claude Code as the subject of the commit. A message explaining what a Claude Code
setting does is describing the work, not signing it. Removing those turns messages into nonsense.

The rewrite used `git filter-repo` with a commit-callback. A pre-rewrite bundle is in
`~/code/archive/projects/.chewbacca-backups/`, and the tree hash was compared before and
after to prove only messages changed.

## From the index

settings.json; it overrides any session instruction saying otherwise.
