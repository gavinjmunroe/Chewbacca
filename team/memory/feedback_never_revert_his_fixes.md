---
name: feedback_never_revert_his_fixes
description: A rewrite that drops fixes he already approved is the worst repeat on visual work; read the file's git log before replacing it, and diff behavior after
metadata:
  type: feedback
---

On 2026-09-21, while the HUD portal was being built, Caleb had to point out lost work six times in one night: "Bro why'd you remove the fades", "Ok why can't I start circles any more you reverted so much functionality bruh", "Bro scan commit history I have a feeling we're missing fixes we implemented before", "Bro we had built in a super detailed spiral to make it not look like a pie refer to commit history", "It is a pie bruh. What happend to all the stuff we did?" and "Bro you reverted the animation like crazy lol". The next day he said it again: "you mustve reverted the animation too bruh". Each one came after a whole-file rewrite that fixed the bug he'd just reported and quietly dropped behavior he had approved earlier. The fades, the circle start threshold, the scaled particles and the spiral all went this way.

The full list of corrections is in `~/Downloads/Every correction to Chewb.md` on his Mac, under the portal saga. Nothing caught this before this note: no lesson and no check.

**Why:** He only finds a lost fix by seeing it, and each one costs another round of "bro". A rewrite trades a fix he's waiting on for a fix he already has.

**How to apply:** Before replacing or rewriting most of a file, run `git log -p --follow -- <file>` and list every behavior earlier commits added. Edit in place over a rewrite. After the change, check that the list still holds before reporting. On visual work, keep the earlier frames or screenshots and compare against them. Related: [[feedback_rebase_reapply_hunks_not_files]], [[feedback_enforce_dont_document]], [[project_portal]].
