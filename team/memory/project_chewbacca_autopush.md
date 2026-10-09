---
name: project_chewbacca_autopush
description: Chewbacca pushes its own committed work on main now, gated by the cheap half of CI; the context store was always auto-pushed and the kit never was.
metadata:
  type: project
---

Built 2026-09-20 after Caleb said "we're supposed to be constantly updating
chewbacca." Before this, `format-and-sync.sh` auto-committed and auto-pushed
the **context store** on every write, and the kit repo was pushed only when
somebody remembered. `~/.claude/d1-config.sh` said so outright: "Chewbacca is
its own repo and is pushed explicitly."

**What exists now.** `.claude/hooks/kit-autopush.sh`, a Stop hook. It finds the
checkout from `CHEWBACCA_REPO_DIR` or `~/.chewbacca/install-manifest.json`,
and pushes when main is ahead. **It never commits**, because a code repo
mid-session holds half-finished work and forty "chore: update" commits is an
unreadable history. Only main, so a feature branch is never force-published.
Logs to `~/.chewbacca/logs/autopush.log`.

**It is gated**, because an auto-push is the push nobody watches: checksums,
the committed-tree check, README counts, skill frontmatter, evals,
secret-scan, and `bash -n` on the shell files in the range. About two seconds.
A failed gate blocks and names which one. Closes 1000-list items 948 and 968.

**Two real bugs found doing it.** `sync-chewbacca.sh` ran its push inside the
commit block with the result discarded, so a failed push was silent and never
retried, which is why one commit sat unpushed. And main published a
SHA256SUMS.txt that did not match its own files, so `curl | bash` refused to
install until it was found by hand: `tools/checksums.py` hashes the WORKING
TREE, so regenerating while a file has uncommitted edits records a hash for
content nobody committed. `tools/committed_checksums.py` is the new check for
that, and its negative control is the real commit that shipped broken.

**Write tests that can fail.** Three of the new tests passed vacuously at
first: `git -C` on a bare repo dies under `safe.bareRepository=explicit` so
both sides compared empty, and a case meant to test the branch guard never
reached it. Two more passed locally and failed on CI because `init.defaultBranch`
is `main` in Caleb's `~/.gitconfig` and `master` on the runner. Break the guard
and re-run before believing a green test.

Related: [[project_chewbacca]], a private note,
[[feedback_verify_the_generated_block]], [[project_chewbacca_install_broken_2026_09_19]]
