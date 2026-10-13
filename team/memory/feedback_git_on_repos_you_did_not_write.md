---
name: feedback_git_on_repos_you_did_not_write
description: Any git call on a repo the kit did not create runs with the safe prefix, filters off, signatures off, submodules closed, and a receipt command carries the same prefix
metadata:
  type: feedback
---

On 2026-10-13 `chewbacca week` (tools/first_win.py) scanned every repo under ~/code with plain `git status` and `git log`. In a scratch repo, plain `git status` ran the repo's own `core.fsmonitor` command, a clean filter in a submodule ran under the parent's status, and `log.showSignature` plus `gpg.program` ran a verifier on `git log`. Five review rounds found these one at a time, plus the receipt telling the person to rerun the unsafe command by hand.

**Why:** a repo's config names programs git runs. Anything cloned under the home folder is a stranger's config, and a read-only scan is still code execution if git launches those programs.

**How to apply:** start from `first_win.SAFE` (fsmonitor, hooks, external diff, untracked cache, protocol, showSignature and every gpg program off), add per-repo `-c filter.<name>.clean=` overrides from a NUL-separated config read, skip status when a filter name is odd, pass `--ignore-submodules=all` and flag repos with `.gitmodules` as not fully checked. Any command written into a receipt or a doc for a person to run uses the same prefix. `write_log.SAFE` and `review_cross.GIT_SAFE` still lack the signature and gpg overrides as of this note. Tests: tests/test_first_win.py plants each case. Related: [[feedback_denylist_gate_is_a_backstop]].
