---
name: feedback-scan-before-import
description: Before pulling any repo into the shared kit, scan every file and its history for personal content; a gold set rode in once and could not be pulled back out of history
metadata:
  type: feedback
---

On 2026-10-09 brain-retrieval was imported into `apps/` with full history. Its two
benchmark question files were written against Caleb's private brain and named
personal notes, so every collaborator could read them. The files came off main the
same day (`bench/goldset.py` now loads them from the private brain), but they stay
in Chewbacca's history until someone rewrites it, which is a force-push on a repo
the whole team clones.

**Why:** a subtree import publishes the repo's entire history in one push. A fix
afterwards cleans HEAD and nothing else.

**How to apply:** before `git subtree add` into the kit, grep the source repo's
files AND `git log -p` for personal markers (private memory paths, health,
relationships, family, phone numbers, personal emails, keys). Anything personal
moves to the private brain first, in the source repo, before the import. Data
written against one person (eval gold sets, fixtures from real messages) is
personal even when the code is not. `tests/no_personal_in_apps.sh` is the
backstop on HEAD and only knows a few markers, so it is not the scan.

Related: [[project_team_memory]], [[feedback_everything_is_part_of_chewbacca]], [[feedback_subtree_import_merge_not_rebase]].
