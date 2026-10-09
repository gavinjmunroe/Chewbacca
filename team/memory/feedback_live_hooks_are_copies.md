---
name: feedback_live_hooks_are_copies
description: "~/.claude/hooks holds COPIES of the kit's hooks, not links, so a hook fix pushed to main never runs until the live copy is replaced; check after every hook change."
metadata:
  node_type: memory
  type: feedback
  originSessionId: a889a7c9-bab0-4b70-ba59-b6db47eba9ae
  modified: 2026-10-09T22:37:27.224Z
---

The hooks Claude Code actually runs are the files in `~/.claude/hooks/`, which `setup.sh` copies from the kit at install time. They are not symlinks. A hook fix that lands on main does nothing until that live copy is replaced.

Found 2026-10-09. The prayer-guard fix (2cb83d10, checks every visible block) and the hooks Python-isolation security fix (9da4b062) had both been on main for hours while the live copies were still the Oct 1 versions, so neither had ever run. `skill-route.sh` was stale too. 9 live hooks matched an older repo version and were upgraded with the old copies backed up to `~/.chewbacca/runtime/hooks-backup-*`. Three (kit-autopull, session-context, vibe-guard) matched no commit, meaning someone edited them live; those were left alone, and only kit-autopull got the `python3 -I` fix applied in place.

Same shape as the 9/7 stale `people` copy (a private note) and a private note.

**Why:** a fix that's merged but not installed reads as done to everyone and protects nothing.
**How to apply:** after changing anything in `.claude/hooks/`, `cmp` the live copy against the repo. If the live copy matches an older commit (`git log --all --find-object=$(git hash-object <live>)`), back it up and copy the new one in. If it matches no commit, it was edited live: patch only your change. A new hook also needs its Stop/PreToolUse entry in `~/.claude/settings.json`, made with the Edit tool (a private note). Then prove it fires with a deliberate failing input.
