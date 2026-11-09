---
name: feedback_archive_keeps_children
description: Archiving a Claude session can archive the sessions it started; check linked children and unarchive any Caleb didn't name
metadata:
  type: feedback
---

Archiving a desktop Claude session can take the child sessions it started (start_session) with it. Before archiving, list the linked children. Any child Caleb didn't name stays open, and after the archive, `list_sessions include_archived` plus `unarchive_session` brings back any child that went with it.

**Why:** 2026-11-03 9:14pm, "Writ hw" was archived and its child "Make brightspace post instant by course and topic name" was archived 28 seconds later. Auto-archive was off and no agent called archive_session. Caleb: "a brightspace tab j randomly disappeared/archived?" The archive_session tool doc confirms it: archiving a session also archives its side sessions that share its worktree or have finished (idle, no open PR).

**How to apply:** step 4 of `.claude/hooks/archive-learn.sh`, tested in tests/archive_learn.sh. Related: [[feedback_archive_means_learn_first]].
