---
name: reference_landed_branches_look_unlanded
description: "chewbacca land rebuilds every commit on a fresh main and regenerates SHA256SUMS, so git cherry and branch --no-merged call landed branches unlanded; match by subject and touched-file content before treating one as lost work"
metadata:
  node_type: memory
  type: reference
---

On 2026-10-19 a branch cleanup found 117 local Chewbacca branches "not merged" into origin/main. 97 had every commit matched by `git cherry origin/main <branch>` (patch-id equal). The other 38 still showed `+` commits.

A read-only triage of those 38 found none with work missing from main. 43 of 43 named commits had a commit on main with the same subject, and the files each one touched matched apart from lines main added later. git can't see it because `chewbacca land` rebuilds each commit on a fresh worktree of main and regenerates SHA256SUMS.txt, so the patch ids differ. Some wip runs landed squashed under one commit too.

How to apply: before calling a branch unlanded, or before deleting one, check each `+` commit for a same-subject commit on main (`git log origin/main --format=%s | grep -F`) and diff only the files it touched. A trial `git merge-tree --write-tree origin/main <branch>` that conflicts usually just means main moved past a change it already has. The triage that did this is in the overnight notes, unlanded-branches.md.
