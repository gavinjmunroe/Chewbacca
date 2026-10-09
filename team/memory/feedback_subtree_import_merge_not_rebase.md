---
name: feedback-subtree-import-merge-not-rebase
description: After a git subtree add, integrate origin with merge; rebase replays the imported history at the repo root
metadata:
  type: feedback
---

On 2026-10-09 `git subtree add --prefix=apps/lemma-replica` worked, then
`git rebase origin/main` tried to replay the imported repo's commits at the root
of Chewbacca and conflicted on README.md. Rebase drops the subtree merge commit.

**Why:** the subtree's history only lands under its prefix through that merge.

**How to apply:** after importing a repo into `apps/`, use `git merge origin/main`
and push. Then regenerate the manifest after staging, because `tools/checksums.py`
hashes the index, not the working tree, and run `tools/counts.py` before pushing,
or pre-push refuses on stale README counts.

Related: [[project_team_memory]], [[feedback_push_only_your_commit]].
