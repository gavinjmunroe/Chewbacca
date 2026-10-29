---
name: feedback_archive_means_learn_first
description: An archive or close-tab ask means every linked tab lands its lessons in Chewbacca first; enforced by the archive-learn prompt hook
metadata:
  type: feedback
---

When Caleb asks to archive or close tabs, every session involved, including the ones this tab started, turns its corrections and breaks into Chewbacca code (tool, test, gate, default or skill section) with `chewbacca land` before anyone says it's safe to archive.

**Why:** 2026-10-29, "Can I archive this tab and the 3 other child tabs?" got a yes and an archive button with no closeout. He wrote "MAKE SURE YOU TELL ALL OF THEM TO LEARN EVERYTHING AND REMEMBER EVERYTHING AND BUILD LESSONS INTO CHEWB!" and "I should never have to say this again."

**How to apply:** `.claude/hooks/archive-learn.sh` (registered by setup.sh, tested by tests/archive_learn.sh) injects the closeout on any archive or close ask. Same day, ready-guard was fixed to skip its own Stop hook feedback rows, which had made a Firm Foundation tab get refused "for Zeutara". Related: [[feedback_never_close_without_updating_chewbacca]].
